import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  activateResponseSchema,
  createOrganizationResponseSchema,
  installResponseSchema,
  variableGroupBindingResponseSchema,
  variableGroupResponseSchema,
  variableGroupUsagesResponseSchema,
  importVariablesResponseSchema,
  inviteUserResponseSchema,
  loginResponseSchema,
  organizationListResponseSchema,
  projectListResponseSchema,
  removeVariableResponseSchema,
  type ActivateResponse,
  type CreateOrganizationResponse,
  type ImportVariablesResponse,
  type InstallResponse,
  type InviteUserResponse,
  type LoginResponse,
  type OrganizationListResponse,
  type OrganizationSummary,
  type RemoveVariableResponse,
  type UserInvitation,
  type VariableGroupBindingResponse,
  type VariableGroupResponse,
  type VariableGroupUsagesResponse,
  type VariableListItem,
  type VariableListResponse,
  type VariableResponse,
  type WhoAmICommandResponse,
  variableListResponseSchema,
  variableResponseSchema,
  whoamiCommandResponseSchema,
} from '@compartment/contracts';
import { buildInternalHttpUrl } from '@compartment/utils';
import {
  deriveProcessScopedDatabaseUrl,
  ensureDatabaseExists,
  findFreePort,
  readDatabaseTestMode,
  readSocketSafeTempRootDirectory,
  runCompartmentApiMigrations,
  resetDatabase,
} from '../../test-support/src';
import { runCli } from '../src/app';
import { readCliConfig, writeCliConfig } from '../src/store/config.store';
import type { CliConfig, CliRemoteConfig } from '../src/store/config.types';
import { completeCliBrowserPasswordLogin } from './cli-browser-login-test.harness';
import { expectCurrentOrganizationSlug } from './cli-response-test.harness';
import { createCliCapture, readCliStderr, readCliStdout } from './cli-test.harness';
import { withInstallDevRepository } from './install-dev-repository-test.harness';
import type { CliOrgUsePayload, CliTestCapture } from './cli.smoke.types';
import {
  cliTestEdgeToken,
  cliTestRuntimeControlToken,
  cliTestSessionSecret,
  cliTestSystemToken,
  readCliTestSessionTtlDuration,
  readCliTestVariablesMasterKeyHex,
} from './runtime-test-env';
import { refreshEdgeAccessState, startRuntimeProcess, type RuntimeProcessHandle } from './runtime-process.harness';
import { findFreePortExcluding } from './public-port-test-support';

const orgUseResponseSchema: z.ZodType<CliOrgUsePayload> = z.object({
  organization: z.object({
    slug: z.string(),
  }),
});
const installInputText: string = 'admin@example.com\nAcme Dev\nsupersecretpassword\nsupersecretpassword\n';
const smokeTempRootDirectory: string = readSocketSafeTempRootDirectory('ccli-', 'sys-65535.sock');

const { testDatabaseUrl } = readDatabaseTestMode();
const cliSmokeDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'cli_smoke');
const cliSmokeHookTimeoutMs: number = 30_000;
const loopbackOidcIssuerUrl: string = 'https://127.0.0.1';
process.env.COMPARTMENT_DATABASE_URL = cliSmokeDatabaseUrl;
process.env.COMPARTMENT_SESSION_SECRET = process.env.COMPARTMENT_SESSION_SECRET ?? cliTestSessionSecret;
let cliSmokeApiPort: number | null = null;
let apiUrl: string = '';
let configDirectory: string = '';
let cliSmokeEdgePort: number | null = null;
let apiProcess: RuntimeProcessHandle | null = null;
let edgeProcess: RuntimeProcessHandle | null = null;
let edgeUrl: string = '';
let smokeTempDirectory: string = '';

describe.sequential('Phase 0 CLI smoke flow', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureDatabaseExists(cliSmokeDatabaseUrl);
    await resetDatabase(cliSmokeDatabaseUrl);
    await runCompartmentApiMigrations(cliSmokeDatabaseUrl);
    cliSmokeApiPort = await findFreePort();
    cliSmokeEdgePort = await findFreePortExcluding([cliSmokeApiPort]);
    smokeTempDirectory = await mkdtemp(join(smokeTempRootDirectory, 'ccli-'));
    apiUrl = buildInternalHttpUrl('127.0.0.1', cliSmokeApiPort);
    edgeUrl = buildInternalHttpUrl('127.0.0.1', cliSmokeEdgePort);
    await startCliSmokeApiProcess();
    edgeProcess = await startRuntimeProcess({
      env: buildEdgeEnvironment(cliSmokeApiPort, cliSmokeEdgePort, smokeTempDirectory),
      packageName: 'edge',
      readyUrl: `${edgeUrl}/healthz`,
    });
  }, cliSmokeHookTimeoutMs);

  beforeEach(async (): Promise<void> => {
    await stopCliSmokeApiProcess();
    await resetDatabase(cliSmokeDatabaseUrl);
    await runCompartmentApiMigrations(cliSmokeDatabaseUrl);
    await startCliSmokeApiProcess();
    await refreshEdgeBootstrap();
    configDirectory = await mkdtemp(join(smokeTempDirectory, 'cfg-'));
    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
  }, cliSmokeHookTimeoutMs);

  afterAll(async (): Promise<void> => {
    await stopCliSmokeApiProcess();
    await edgeProcess?.stop();
    await rm(smokeTempDirectory, { force: true, recursive: true });
  });

  afterEach(async (): Promise<void> => {
    await stopCliSmokeApiProcess();
    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    await rm(configDirectory, { force: true, recursive: true });
    configDirectory = '';
  }, cliSmokeHookTimeoutMs);

  it('runs install --dev, whoami, org list, and org use without a separate login step', async (): Promise<void> => {
    await runInstallDev(apiUrl);

    const whoAmICapture: CliTestCapture = createCliCapture();
    const whoAmIExitCode: number = await runCli(['whoami', '--output', 'json'], whoAmICapture.io);
    expect(whoAmIExitCode).toBe(0);
    const whoAmIPayload: WhoAmICommandResponse = whoamiCommandResponseSchema.parse(
      JSON.parse(readCliStdout(whoAmICapture)),
    );
    expectCurrentOrganizationSlug(whoAmIPayload, 'acme-dev');
    expect(whoAmIPayload.apiUrl).toBe(apiUrl);

    const orgListCapture: CliTestCapture = createCliCapture();
    const orgListExitCode: number = await runCli(['org', 'list', '--output', 'json'], orgListCapture.io);
    expect(orgListExitCode).toBe(0);
    const orgListPayload: OrganizationListResponse = organizationListResponseSchema.parse(
      JSON.parse(readCliStdout(orgListCapture)),
    );
    expect(orgListPayload.organizations).toHaveLength(1);

    const orgUseCapture: CliTestCapture = createCliCapture();
    const orgUseExitCode: number = await runCli(['org', 'use', 'acme-dev', '--output', 'json'], orgUseCapture.io);
    expect(orgUseExitCode).toBe(0);
    const orgUsePayload: CliOrgUsePayload = orgUseResponseSchema.parse(JSON.parse(readCliStdout(orgUseCapture)));
    expect(orgUsePayload.organization.slug).toBe('acme-dev');
  });

  it('creates an organization through the CLI and switches the current selection', async (): Promise<void> => {
    await runInstallDev(apiUrl);

    const createOrganizationCapture: CliTestCapture = createCliCapture();
    const createOrganizationExitCode: number = await runCli(
      ['org', 'create', '--name', 'Beta Dev', '--output', 'json'],
      createOrganizationCapture.io,
    );
    expect(createOrganizationExitCode).toBe(0);
    const createOrganizationPayload: CreateOrganizationResponse = createOrganizationResponseSchema.parse(
      JSON.parse(readCliStdout(createOrganizationCapture)),
    );
    expect(createOrganizationPayload.organization.slug).toBe('beta-dev');

    const whoAmICapture: CliTestCapture = createCliCapture();
    const whoAmIExitCode: number = await runCli(['whoami', '--output', 'json'], whoAmICapture.io);
    expect(whoAmIExitCode).toBe(0);
    const whoAmIPayload: WhoAmICommandResponse = whoamiCommandResponseSchema.parse(
      JSON.parse(readCliStdout(whoAmICapture)),
    );
    expectCurrentOrganizationSlug(whoAmIPayload, 'beta-dev');

    const orgListCapture: CliTestCapture = createCliCapture();
    const orgListExitCode: number = await runCli(['org', 'list', '--output', 'json'], orgListCapture.io);
    expect(orgListExitCode).toBe(0);
    const orgListPayload: OrganizationListResponse = organizationListResponseSchema.parse(
      JSON.parse(readCliStdout(orgListCapture)),
    );
    expect(readSortedOrganizationSlugs(orgListPayload.organizations)).toEqual(['acme-dev', 'beta-dev']);
  });

  it('logs back in after logout through the real browser flow', async (): Promise<void> => {
    await runInstallDev(apiUrl);

    const logoutCapture: CliTestCapture = createCliCapture();
    const logoutExitCode: number = await runCli(['logout', '--output', 'json'], logoutCapture.io);
    expect(logoutExitCode).toBe(0);

    const loginCapture: CliTestCapture = createCliCapture();
    const loginExitCodePromise: Promise<number> = runCli(
      ['login', '--api-url', apiUrl, '--output', 'json'],
      loginCapture.io,
    );
    await completeCliBrowserPasswordLogin({
      email: 'Admin@Example.com',
      password: 'supersecretpassword',
      requestOrigin: apiUrl,
      verificationUrlPromise: waitForCliVerificationUrl(loginCapture),
    });
    const loginExitCode: number = await loginExitCodePromise;

    expect(loginExitCode).toBe(0);
    const loginPayload: LoginResponse = loginResponseSchema.parse(JSON.parse(readCliStdout(loginCapture)));
    expect(loginPayload.principal.email).toBe('admin@example.com');
    expect(loginPayload.organizations.map((organization: OrganizationSummary): string => organization.slug)).toEqual([
      'acme-dev',
    ]);

    const whoAmICapture: CliTestCapture = createCliCapture();
    const whoAmIExitCode: number = await runCli(['whoami', '--output', 'json'], whoAmICapture.io);

    expect(whoAmIExitCode).toBe(0);
    const whoAmIPayload: WhoAmICommandResponse = whoamiCommandResponseSchema.parse(
      JSON.parse(readCliStdout(whoAmICapture)),
    );
    expect(whoAmIPayload.apiUrl).toBe(apiUrl);
    expectCurrentOrganizationSlug(whoAmIPayload, 'acme-dev');
    expect(whoAmIPayload.principal.email).toBe('admin@example.com');
  }, 15_000);

  it('rejects a loopback OIDC issuer through the CLI SSO setup flow', async (): Promise<void> => {
    await runInstallDev(apiUrl);

    const providerCapture: CliTestCapture = createCliCapture();
    const providerExitCode: number = await runCli(
      [
        'sso',
        'oidc',
        'add',
        '--client-id',
        'smoke-client',
        '--client-secret',
        'smoke-secret',
        '--display-name',
        'Smoke OIDC',
        '--issuer-url',
        loopbackOidcIssuerUrl,
        '--key',
        'smoke-oidc',
        '--output',
        'json',
      ],
      providerCapture.io,
    );
    expect(providerExitCode).toBe(1);
    expect(readCliStderr(providerCapture)).toContain('must be listed in COMPARTMENT_TRUSTED_OUTBOUND_HOSTS');
  }, 20_000);

  it('clears the local CLI config when logout sees an expired session', async (): Promise<void> => {
    await runInstallDev(apiUrl);

    const installedConfig: CliConfig = await readCliConfig();
    const installedRemoteName: string | undefined = installedConfig.currentRemote;
    const installedRemote: CliRemoteConfig | undefined =
      installedRemoteName !== undefined ? installedConfig.remotes?.[installedRemoteName] : undefined;
    if (installedRemoteName === undefined || installedRemote === undefined) {
      throw new Error('Expected an installed dev remote after install.');
    }
    await writeCliConfig({
      ...installedConfig,
      remotes: {
        ...(installedConfig.remotes ?? {}),
        [installedRemoteName]: {
          ...installedRemote,
          sessionToken: 'expired_session',
        },
      },
    });

    const logoutCapture: CliTestCapture = createCliCapture();
    const logoutExitCode: number = await runCli(['logout', '--output', 'json'], logoutCapture.io);

    expect(logoutExitCode).toBe(1);
    expect(readCliStdout(logoutCapture)).toBe('');
    expect(readCliStderr(logoutCapture)).toContain('A valid session is required.');
    await expect(readCliConfig()).resolves.toEqual({
      currentRemote: installedRemoteName,
      remotes: {
        [installedRemoteName]: {
          apiUrl,
        },
      },
    });

    const whoAmICapture: CliTestCapture = createCliCapture();
    const whoAmIExitCode: number = await runCli(['whoami', '--output', 'json'], whoAmICapture.io);

    expect(whoAmIExitCode).toBe(1);
    expect(readCliStdout(whoAmICapture)).toBe('');
    expect(readCliStderr(whoAmICapture)).toContain(
      `You are not logged in for remote "${installedRemoteName}". Run \`compartment login --remote ${installedRemoteName}\` first.`,
    );
  });

  it('clears the local CLI config when logout hits a network error', async (): Promise<void> => {
    await runInstallDev(apiUrl);

    const installedConfig: CliConfig = await readCliConfig();
    const unreachablePort: number = await findFreePort();
    const installedRemoteName: string | undefined = installedConfig.currentRemote;
    const installedRemote: CliRemoteConfig | undefined =
      installedRemoteName !== undefined ? installedConfig.remotes?.[installedRemoteName] : undefined;
    if (installedRemoteName === undefined || installedRemote === undefined) {
      throw new Error('Expected an installed dev remote after install.');
    }
    await writeCliConfig({
      ...installedConfig,
      remotes: {
        ...(installedConfig.remotes ?? {}),
        [installedRemoteName]: {
          ...installedRemote,
          apiUrl: buildInternalHttpUrl('127.0.0.1', unreachablePort),
        },
      },
    });

    const logoutCapture: CliTestCapture = createCliCapture();
    const logoutExitCode: number = await runCli(['logout', '--output', 'json'], logoutCapture.io);

    expect(logoutExitCode).toBe(1);
    expect(readCliStdout(logoutCapture)).toBe('');
    expect(readCliStderr(logoutCapture)).toContain('POST /v1/auth/logout failed: connection refused.');
    await expect(readCliConfig()).resolves.toEqual({
      currentRemote: installedRemoteName,
      remotes: {
        [installedRemoteName]: {
          apiUrl: buildInternalHttpUrl('127.0.0.1', unreachablePort),
        },
      },
    });
  });

  it('keeps the current organization when org use receives an unknown slug', async (): Promise<void> => {
    await runInstallDev(apiUrl);

    const orgUseCapture: CliTestCapture = createCliCapture();
    const orgUseExitCode: number = await runCli(['org', 'use', 'missing-org', '--output', 'json'], orgUseCapture.io);

    expect(orgUseExitCode).toBe(1);
    expect(readCliStdout(orgUseCapture)).toBe('');
    expect(readCliStderr(orgUseCapture)).toContain('Organization slug "missing-org" was not found.');

    const whoAmICapture: CliTestCapture = createCliCapture();
    const whoAmIExitCode: number = await runCli(['whoami', '--output', 'json'], whoAmICapture.io);

    expect(whoAmIExitCode).toBe(0);
    const whoAmIPayload: WhoAmICommandResponse = whoamiCommandResponseSchema.parse(
      JSON.parse(readCliStdout(whoAmICapture)),
    );
    expectCurrentOrganizationSlug(whoAmIPayload, 'acme-dev');
    expect(whoAmIPayload.apiUrl).toBe(apiUrl);
  });

  it('runs direct variable set/list/show/remove/import through the live CLI flow', async (): Promise<void> => {
    await runInstallDev(apiUrl);
    await withSmokeProjectDirectory(async (): Promise<void> => {
      const setCapture: CliTestCapture = createCliCapture();
      const setExitCode: number = await runCli(
        ['variable', 'set', 'LOG_LEVEL', 'info', '--output', 'json'],
        setCapture.io,
      );
      expect(setExitCode).toBe(0);
      const setPayload: VariableResponse = variableResponseSchema.parse(JSON.parse(readCliStdout(setCapture)));
      expect(setPayload.variable.keyName).toBe('LOG_LEVEL');
      expect(setPayload.variable.value).toBe('info');

      const serviceFailureCapture: CliTestCapture = createCliCapture();
      const serviceFailureExitCode: number = await runCli(
        ['variable', 'set', 'FEATURE_FLAG', 'enabled', '--service', 'web', '--output', 'json'],
        serviceFailureCapture.io,
      );
      expect(serviceFailureExitCode).toBe(1);
      expect(readCliStderr(serviceFailureCapture)).toContain('The requested service was not found.');

      const listCapture: CliTestCapture = createCliCapture();
      const listExitCode: number = await runCli(['variable', 'list', '--output', 'json'], listCapture.io);
      expect(listExitCode).toBe(0);
      const listPayload: VariableListResponse = variableListResponseSchema.parse(
        JSON.parse(readCliStdout(listCapture)),
      );
      expect(listPayload.variables).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            keyName: 'LOG_LEVEL',
            scopeServiceName: null,
            scopeType: 'environment',
          }),
        ]),
      );

      const showCapture: CliTestCapture = createCliCapture();
      const showExitCode: number = await runCli(['variable', 'show', 'LOG_LEVEL', '--output', 'json'], showCapture.io);
      expect(showExitCode).toBe(0);
      const showPayload: VariableResponse = variableResponseSchema.parse(JSON.parse(readCliStdout(showCapture)));
      expect(showPayload.variable.value).toBe('info');

      await writeFile(join(process.cwd(), '.env.import'), 'LOG_LEVEL=debug\nIMPORTED_FLAG=true\n', 'utf8');
      const importCapture: CliTestCapture = createCliCapture();
      const importExitCode: number = await runCli(
        ['variable', 'import', '--file', '.env.import', '--replace', '--output', 'json'],
        importCapture.io,
      );
      expect(importExitCode).toBe(0);
      const importPayload: ImportVariablesResponse = importVariablesResponseSchema.parse(
        JSON.parse(readCliStdout(importCapture)),
      );
      expect(importPayload.importedKeyNames).toEqual(['LOG_LEVEL', 'IMPORTED_FLAG']);

      const listAfterImportCapture: CliTestCapture = createCliCapture();
      const listAfterImportExitCode: number = await runCli(
        ['variable', 'list', '--output', 'json'],
        listAfterImportCapture.io,
      );
      expect(listAfterImportExitCode).toBe(0);
      const listAfterImportPayload: VariableListResponse = variableListResponseSchema.parse(
        JSON.parse(readCliStdout(listAfterImportCapture)),
      );
      expect(
        listAfterImportPayload.variables.find(
          (variable: VariableListItem): boolean =>
            variable.keyName === 'IMPORTED_FLAG' && variable.scopeServiceName === null,
        ),
      ).toBeDefined();

      const removeCapture: CliTestCapture = createCliCapture();
      const removeExitCode: number = await runCli(
        ['variable', 'remove', 'IMPORTED_FLAG', '--output', 'json'],
        removeCapture.io,
      );
      expect(removeExitCode).toBe(0);
      const removePayload: RemoveVariableResponse = removeVariableResponseSchema.parse(
        JSON.parse(readCliStdout(removeCapture)),
      );
      expect(removePayload.success).toBe(true);

      const finalListCapture: CliTestCapture = createCliCapture();
      const finalListExitCode: number = await runCli(['variable', 'list', '--output', 'json'], finalListCapture.io);
      expect(finalListExitCode).toBe(0);
      const finalListPayload: VariableListResponse = variableListResponseSchema.parse(
        JSON.parse(readCliStdout(finalListCapture)),
      );
      expect(
        finalListPayload.variables.find((variable: VariableListItem): boolean => variable.keyName === 'IMPORTED_FLAG'),
      ).toBeUndefined();
    });
  });

  it('runs variable group bind and unbind through the live CLI flow', async (): Promise<void> => {
    await runInstallDev(apiUrl);
    await withSmokeProjectDirectory(async (): Promise<void> => {
      const createCapture: CliTestCapture = createCliCapture();
      const createExitCode: number = await runCli(
        ['variable', 'group', 'create', 'shared-runtime', '--output', 'json'],
        createCapture.io,
      );
      expect(createExitCode).toBe(0);
      const createPayload: VariableGroupResponse = variableGroupResponseSchema.parse(
        JSON.parse(readCliStdout(createCapture)),
      );
      expect(createPayload.variableGroup.name).toBe('shared-runtime');

      const putCapture: CliTestCapture = createCliCapture();
      const putExitCode: number = await runCli(
        ['variable', 'group', 'put', 'shared-runtime', 'DATABASE_URL', 'postgres://grouped', '--output', 'json'],
        putCapture.io,
      );
      expect(putExitCode).toBe(0);
      const putPayload: VariableGroupResponse = variableGroupResponseSchema.parse(
        JSON.parse(readCliStdout(putCapture)),
      );
      expect(putPayload.variableGroup.variableCount).toBe(1);

      const bindCapture: CliTestCapture = createCliCapture();
      const bindExitCode: number = await runCli(
        ['variable', 'bind', 'shared-runtime', '--output', 'json'],
        bindCapture.io,
      );
      expect(bindExitCode).toBe(0);
      const bindPayload: VariableGroupBindingResponse = variableGroupBindingResponseSchema.parse(
        JSON.parse(readCliStdout(bindCapture)),
      );
      expect(bindPayload.variableGroupName).toBe('shared-runtime');

      const showCapture: CliTestCapture = createCliCapture();
      const showExitCode: number = await runCli(
        ['variable', 'show', 'DATABASE_URL', '--output', 'json'],
        showCapture.io,
      );
      expect(showExitCode).toBe(0);
      const showPayload: VariableResponse = variableResponseSchema.parse(JSON.parse(readCliStdout(showCapture)));
      expect(showPayload.variable.sourceType).toBe('set');
      expect(showPayload.variable.sourceVariableSetName).toBe('shared-runtime');

      const usagesCapture: CliTestCapture = createCliCapture();
      const usagesExitCode: number = await runCli(
        ['variable', 'group', 'usages', 'shared-runtime', '--output', 'json'],
        usagesCapture.io,
      );
      expect(usagesExitCode).toBe(0);
      const usagesPayload: VariableGroupUsagesResponse = variableGroupUsagesResponseSchema.parse(
        JSON.parse(readCliStdout(usagesCapture)),
      );
      expect(usagesPayload.usages).toEqual([
        expect.objectContaining({
          environmentName: 'production',
          projectName: 'billing',
          serviceName: null,
        }),
      ]);

      const unbindCapture: CliTestCapture = createCliCapture();
      const unbindExitCode: number = await runCli(
        ['variable', 'unbind', 'shared-runtime', '--output', 'json'],
        unbindCapture.io,
      );
      expect(unbindExitCode).toBe(0);
      const unbindPayload: VariableGroupBindingResponse = variableGroupBindingResponseSchema.parse(
        JSON.parse(readCliStdout(unbindCapture)),
      );
      expect(unbindPayload.variableGroupName).toBe('shared-runtime');
    });
  });

  it('injects sensitive variables into one local child process without writing an env file', async (): Promise<void> => {
    await runInstallDev(apiUrl);
    await withSmokeProjectDirectory(async (): Promise<void> => {
      const setCapture: CliTestCapture = createCliCapture();
      setCapture.stdin.end('postgres://smoke-local\n');
      const setExitCode: number = await runCli(
        ['variable', 'set', 'DATABASE_URL', '--env', 'development', '--sensitive', '--stdin'],
        setCapture.io,
      );
      expect(setExitCode).toBe(0);

      const outputPath: string = join(process.cwd(), 'local-run-value.txt');
      const runCapture: CliTestCapture = createCliCapture();
      const runExitCode: number = await runCli(
        [
          'variable',
          'run',
          '--env',
          'development',
          '--',
          'node',
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(outputPath)}, process.env.DATABASE_URL ?? '')`,
        ],
        runCapture.io,
      );

      expect(runExitCode).toBe(0);
      await expect(readFile(outputPath, 'utf8')).resolves.toBe('postgres://smoke-local');
      await expect(pathExists(join(process.cwd(), '.env'))).resolves.toBe(false);
      expect(readCliStdout(runCapture)).toBe('');
    });
  });

  it('fails install --dev when the repo root .env does not define COMPARTMENT_API_URL', async (): Promise<void> => {
    const installCapture: CliTestCapture = createCliCapture();
    installCapture.stdin.end(installInputText);

    await withInstallDevRepository('# intentionally missing COMPARTMENT_API_URL\n', async (): Promise<void> => {
      const installExitCode: number = await runCli(
        ['install', '--dev', '--organization-slug', 'acme-dev', '--output', 'json'],
        installCapture.io,
      );

      expect(installExitCode).toBe(1);
      expect(readCliStdout(installCapture)).toBe('');
      expect(readCliStderr(installCapture)).toContain('The compartment repo root .env is missing COMPARTMENT_API_URL');
    });
  });

  it('invites and activates a user through CLI, then allows project list access but blocks deployment access', async (): Promise<void> => {
    await runInstallDev(apiUrl);

    const inviteCapture: CliTestCapture = createCliCapture();
    const inviteExitCode: number = await runCli(
      ['user', 'invite', 'Viewer@Example.com', '--output', 'json'],
      inviteCapture.io,
    );
    expect(inviteExitCode).toBe(0);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(JSON.parse(readCliStdout(inviteCapture)));
    expect(invitePayload.user.roleNames).toEqual([]);
    expect(invitePayload.user.status).toBe('invited');

    const logoutCapture: CliTestCapture = createCliCapture();
    const logoutExitCode: number = await runCli(['logout', '--output', 'json'], logoutCapture.io);
    expect(logoutExitCode).toBe(0);

    const activateCapture: CliTestCapture = createCliCapture();
    activateCapture.stdin.end('viewersecretpassword\nviewersecretpassword\n');
    const activateExitCode: number = await runCli(
      [
        'activate',
        '--api-url',
        apiUrl,
        '--email',
        'viewer@example.com',
        '--token',
        expectCreatedInvitation(invitePayload).bootstrapToken,
        '--output',
        'json',
      ],
      activateCapture.io,
    );
    expect(activateExitCode).toBe(0);
    const activatePayload: ActivateResponse = activateResponseSchema.parse(JSON.parse(readCliStdout(activateCapture)));
    expect(activatePayload.principal.email).toBe('Viewer@Example.com');

    const viewerWhoAmICapture: CliTestCapture = createCliCapture();
    const viewerWhoAmIExitCode: number = await runCli(['whoami', '--output', 'json'], viewerWhoAmICapture.io);
    expect(viewerWhoAmIExitCode).toBe(0);
    expect(whoamiCommandResponseSchema.parse(JSON.parse(readCliStdout(viewerWhoAmICapture))).principal.email).toBe(
      'Viewer@Example.com',
    );

    const projectListCapture: CliTestCapture = createCliCapture();
    const projectListExitCode: number = await runCli(['project', 'list', '--output', 'json'], projectListCapture.io);
    expect(projectListExitCode).toBe(0);
    projectListResponseSchema.parse(JSON.parse(readCliStdout(projectListCapture)));
    expect(readCliStderr(projectListCapture)).toBe('');

    const deploymentListCapture: CliTestCapture = createCliCapture();
    const deploymentListExitCode: number = await runCli(
      ['deployment', 'list', '--project', 'smoke-web', '--output', 'json'],
      deploymentListCapture.io,
    );
    expect(deploymentListExitCode).toBe(1);
    expect(readCliStdout(deploymentListCapture)).toBe('');
    expect(readCliStderr(deploymentListCapture)).toContain('The requested project was not found.');

    const promoteCapture: CliTestCapture = createCliCapture();
    const promoteExitCode: number = await runCli(
      ['promote', '--project', 'smoke-web', '--from', 'production', '--to', 'staging', '--output', 'json'],
      promoteCapture.io,
    );
    expect(promoteExitCode).toBe(1);
    expect(readCliStdout(promoteCapture)).toBe('');
    expect(readCliStderr(promoteCapture)).toContain('The requested project was not found.');

    const rollbackCapture: CliTestCapture = createCliCapture();
    const rollbackExitCode: number = await runCli(
      ['rollback', '--project', 'smoke-web', '--env', 'production', '--service', 'web', '--output', 'json'],
      rollbackCapture.io,
    );
    expect(rollbackExitCode).toBe(1);
    expect(readCliStdout(rollbackCapture)).toBe('');
    expect(readCliStderr(rollbackCapture)).toContain('The requested project was not found.');
  });

  it('prevents an admin from removing their own organization access', async (): Promise<void> => {
    await runInstallDev(apiUrl);

    const selfRemoveCapture: CliTestCapture = createCliCapture();
    const selfRemoveExitCode: number = await runCli(
      ['user', 'remove', 'admin@example.com', '--yes', '--output', 'json'],
      selfRemoveCapture.io,
    );
    expect(selfRemoveExitCode).toBe(1);
    expect(readCliStdout(selfRemoveCapture)).toBe('');
    expect(readCliStderr(selfRemoveCapture)).toContain(
      'Admin users cannot remove or demote their own organization access.',
    );
  });
});

function buildApiEnvironment(
  databaseUrl: string,
  apiPort: number,
  edgePort: number,
  tempDirectory: string,
): NodeJS.ProcessEnv {
  return {
    COMPARTMENT_API_BIND_HOST: '127.0.0.1',
    COMPARTMENT_API_PORT: apiPort.toString(),
    COMPARTMENT_DATABASE_URL: databaseUrl,
    COMPARTMENT_EDGE_INTERNAL_HOST: '127.0.0.1',
    COMPARTMENT_EDGE_PORT: edgePort.toString(),
    COMPARTMENT_EDGE_TOKEN: cliTestEdgeToken,
    COMPARTMENT_LOG_LEVEL: 'silent',
    COMPARTMENT_PUBLIC_PROTOCOL: 'http',
    COMPARTMENT_PUBLIC_HTTP_PORT: edgePort.toString(),
    COMPARTMENT_PUBLIC_HTTPS_PORT: '443',
    COMPARTMENT_SESSION_SECRET: cliTestSessionSecret,
    COMPARTMENT_SESSION_TTL: readCliTestSessionTtlDuration(),
    COMPARTMENT_SOURCE_ARCHIVE_DIR: join(tempDirectory, 'sa'),
    COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES: '104857600',
    COMPARTMENT_SYSTEM_API_SOCKET: join(tempDirectory, 's', `sys-${apiPort.toString()}.sock`),
    COMPARTMENT_SYSTEM_TOKEN: cliTestSystemToken,
    COMPARTMENT_VARIABLES_MASTER_KEY: readCliTestVariablesMasterKeyHex(),
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: cliTestRuntimeControlToken,
    TMPDIR: tempDirectory,
  };
}

function buildEdgeEnvironment(apiPort: number, edgePort: number, tempDirectory: string): NodeJS.ProcessEnv {
  return {
    COMPARTMENT_API_INTERNAL_HOST: '127.0.0.1',
    COMPARTMENT_API_PORT: apiPort.toString(),
    COMPARTMENT_BASE_DOMAIN: 'localhost',
    COMPARTMENT_EDGE_BIND_HOST: '127.0.0.1',
    COMPARTMENT_EDGE_PORT: edgePort.toString(),
    COMPARTMENT_EDGE_SNAPSHOT_PATH: join(tempDirectory, 'edge', 'access-state.json'),
    COMPARTMENT_EDGE_TOKEN: cliTestEdgeToken,
    COMPARTMENT_LOG_LEVEL: 'silent',
    COMPARTMENT_PUBLIC_PROTOCOL: 'http',
    TMPDIR: tempDirectory,
  };
}

async function startCliSmokeApiProcess(): Promise<void> {
  if (apiProcess !== null) {
    throw new Error('Expected CLI smoke API process to be stopped before starting it.');
  }
  if (cliSmokeApiPort === null || cliSmokeEdgePort === null || apiUrl === '') {
    throw new Error('Expected CLI smoke API runtime ports to be configured.');
  }

  apiProcess = await startRuntimeProcess({
    env: buildApiEnvironment(cliSmokeDatabaseUrl, cliSmokeApiPort, cliSmokeEdgePort, smokeTempDirectory),
    packageName: 'api',
    readyUrl: `${apiUrl}/healthz`,
  });
}

async function stopCliSmokeApiProcess(): Promise<void> {
  const runningApiProcess: RuntimeProcessHandle | null = apiProcess;
  apiProcess = null;
  await runningApiProcess?.stop();
}

async function refreshEdgeBootstrap(): Promise<void> {
  if (edgeProcess === null || edgeUrl === '') {
    throw new Error('Expected CLI smoke edge runtime to be configured.');
  }

  await refreshEdgeAccessState(apiUrl, edgeUrl, cliTestEdgeToken);
}

async function runInstallDev(targetApiUrl: string): Promise<InstallResponse> {
  const installCapture: CliTestCapture = createCliCapture();
  installCapture.stdin.end(installInputText);

  return await withInstallDevRepository(`COMPARTMENT_API_URL=${targetApiUrl}\n`, async (): Promise<InstallResponse> => {
    const installExitCode: number = await runCli(
      ['install', '--dev', '--organization-slug', 'acme-dev', '--output', 'json'],
      installCapture.io,
    );

    expect(installExitCode).toBe(0);
    return installResponseSchema.parse(JSON.parse(readCliStdout(installCapture)));
  });
}

async function waitForCliVerificationUrl(capture: CliTestCapture, timeoutMs: number = 5_000): Promise<string> {
  const deadlineAt: number = Date.now() + timeoutMs;

  for (;;) {
    const stderrOutput: string = readCliStderr(capture);
    const match: RegExpExecArray | null = /https?:\/\/\S+/u.exec(stderrOutput);
    if (match?.[0] !== undefined) {
      return match[0];
    }
    if (Date.now() >= deadlineAt) {
      throw new Error(`Timed out waiting for a CLI verification URL.\n${stderrOutput}`);
    }

    await sleep(50);
  }
}

function expectCreatedInvitation(payload: InviteUserResponse): UserInvitation {
  const invitation: UserInvitation | null = payload.invitation;
  if (invitation === null) {
    throw new Error('Expected the CLI invite flow to return an activation invitation.');
  }

  return invitation;
}

async function withSmokeProjectDirectory(action: () => Promise<void>): Promise<void> {
  const parentDirectory: string = await mkdtemp(join(smokeTempDirectory, 'ws-'));
  const projectDirectory: string = join(parentDirectory, 'billing');
  const previousCwd: string = process.cwd();

  try {
    await mkdir(projectDirectory);
    await writeFile(
      join(projectDirectory, 'compartment.yml'),
      `name: billing

services:
  web: .
  worker:
    kind: worker
    path: ./worker
`,
      'utf8',
    );
    process.chdir(projectDirectory);
    await action();
  } finally {
    process.chdir(previousCwd);
    await rm(parentDirectory, { force: true, recursive: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function readSortedOrganizationSlugs(organizations: OrganizationSummary[]): string[] {
  return organizations
    .map((organization: OrganizationSummary): string => organization.slug)
    .sort((left: string, right: string): number => left.localeCompare(right));
}
