import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  installResponseSchema,
  resourceResponseSchema,
  resourceBackupCreateResponseSchema,
  resourceBackupListResponseSchema,
  variableResponseSchema,
  type InstallResponse,
  type ResourceBackupCreateResponse,
  type ResourceBackupListResponse,
  type ResourceBackupSummary,
  type ResourceResponse,
  type VariableResponse,
} from '@compartment/contracts';
import { readSocketSafeTempRootDirectory } from '@compartment/test-support';
import type { JsonValue } from '@compartment/utils';
import { parse } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  expectAppDatabaseValue,
  expectAppDirectFlag,
  readAppSessionCookieWithRetry,
  writeAppDatabaseValue,
} from './self-hosted-user-setup-app-probe.harness';
import {
  createSelfHostedUserSetupAppFixture,
  type SelfHostedUserSetupAppFixture,
} from './self-hosted-user-setup-app-fixture';
import { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import {
  deployCommandResponseParser,
  requireRouteUrl,
  type SelfHostedDeployCommandResponse,
} from './self-hosted-user-setup-cli-response.harness';
import { buildSelfHostedUserSetupClientEnv } from './self-hosted-user-setup-client-env.harness';
import { waitForRunningResource } from './self-hosted-user-setup-deployment-flow.harness';
import {
  assertBuiltCliAvailable,
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

interface HelmListReleaseOutput {
  readonly revision?: string | undefined;
  readonly status?: string | undefined;
}

interface PlatformImageValues {
  readonly images?: Record<string, { readonly digest?: string | undefined; readonly repository?: string | undefined }>;
}

interface PlatformImageValue {
  readonly digest?: string | undefined;
  readonly repository?: string | undefined;
}

const platformModeEnvName: string = 'COMPARTMENT_E2E_PLATFORM_MODE';
const previousCliPath: string = requireEnvironment('COMPARTMENT_E2E_PREVIOUS_CLI_PATH');
const platformApiUrl: string = process.env.COMPARTMENT_E2E_API_URL ?? 'http://console.compartment.localhost:18580';
const platformBaseDomain: string = 'compartment.localhost';
const platformKubeContext: string = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e-upgrade';
const platformNamespace: string = process.env.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? 'compartment-upgrade';
const currentValuesPath: string = requireEnvironment('COMPARTMENT_E2E_PLATFORM_VALUES_PATH');
const previousValuesPath: string = requireEnvironment('COMPARTMENT_E2E_PREVIOUS_PLATFORM_VALUES_PATH');
const releaseName: string = 'compartment';
const upgradeTimeoutMs: number = 50 * 60_000;
const tempRootDirectory: string = readSocketSafeTempRootDirectory('pk3u-', 'system-api.sock');
const createdDirectories: string[] = [];

describe.sequential('production Kubernetes upgrade', (): void => {
  if (process.env[platformModeEnvName] !== 'k3d') {
    it(`requires ${platformModeEnvName}=k3d`, (): void => {
      expect(process.env[platformModeEnvName]).toBe('k3d');
    });
    return;
  }

  let cli: SelfHostedUserSetupCli;
  let app: SelfHostedUserSetupAppFixture;
  let adminEmail: string;
  let adminPassword: string;
  let installCommand: string;

  beforeAll(async (): Promise<void> => {
    await assertBuiltCliAvailable();
    const homeDirectory: string = await createTemporaryDirectory('client-');
    const clientEnvironment: NodeJS.ProcessEnv = buildSelfHostedUserSetupClientEnv(homeDirectory);
    adminEmail = `upgrade-${randomUUID().replaceAll('-', '').slice(0, 12)}@compartment.test`;
    adminPassword = `Upgrade-${randomBytes(24).toString('base64url')}!`;
    clientEnvironment.COMPARTMENT_ADMIN_PASSWORD = adminPassword;
    cli = new SelfHostedUserSetupCli(clientEnvironment, upgradeTimeoutMs);
    app = await createSelfHostedUserSetupAppFixture(tempRootDirectory, { projectName: 'upgrade-gate-app' });
    createdDirectories.push(app.directory);
    installCommand = buildInstallCommand(adminEmail);
  });

  afterAll(async (): Promise<void> => {
    await Promise.all(
      createdDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it(
    'upgrades the last chart with persistent workloads to the current build without losing state',
    async (): Promise<void> => {
      const previousInstall: SelfHostedUserSetupCommandResult = await runCommand({
        argv: [previousCliPath, ...splitCommandLine(`${installCommand} --values ${previousValuesPath} --output json`)],
        env: cli.readCommandEnvironment(),
        timeoutMs: upgradeTimeoutMs,
      });
      expectSuccessfulCommand(previousInstall, 'install the previous published Kubernetes build');
      const installed: InstallResponse = installResponseSchema.parse(JSON.parse(previousInstall.stdout) as JsonValue);
      expect(installed.adminEmail).toBe(adminEmail);

      const previousRevision: number = await readHelmRevision();
      await setSensitiveFixtureValue();
      await cli.runJson('deploy', deployCommandResponseParser, {
        cwd: app.directory,
      });
      const resource: ResourceResponse = await cli.runJson(
        `resource bootstrap --project ${app.projectName} --resource ${app.resourceName}`,
        resourceResponseSchema,
      );
      expect(resource.resource.name).toBe(app.resourceName);
      await waitForRunningResource(cli, app.projectName, app.resourceName);
      const deployment: SelfHostedDeployCommandResponse = await cli.runJson('deploy', deployCommandResponseParser, {
        cwd: app.directory,
      });
      const routeUrl: string = requireRouteUrl(deployment, app.serviceName);
      const appSessionCookie: string = await readAppSessionCookieWithRetry(routeUrl, {
        email: adminEmail,
        password: adminPassword,
      });
      await expectAppDirectFlag(routeUrl, appSessionCookie, 'encrypted-upgrade-secret');
      await writeAppDatabaseValue(routeUrl, appSessionCookie, 'persisted-across-platform-upgrade');
      const backup: ResourceBackupCreateResponse = await cli.runJson(
        `resource backup create --project ${app.projectName} --resource ${app.resourceName}`,
        resourceBackupCreateResponseSchema,
      );
      expect(backup.backup.status).toBe('succeeded');

      await cli.runJson(`${installCommand} --values ${currentValuesPath}`, installResponseSchema);

      const upgradedRevision: number = await readHelmRevision();
      expect(upgradedRevision).toBeGreaterThan(previousRevision);
      await expectCurrentPlatformImages();
      await expectRemovedBuildkitObjectsAbsent();
      const upgradedAppSessionCookie: string = await readAppSessionCookieWithRetry(routeUrl, {
        email: adminEmail,
        password: adminPassword,
      });
      await expectAppDirectFlag(routeUrl, upgradedAppSessionCookie, 'encrypted-upgrade-secret');
      await expectAppDatabaseValue(routeUrl, upgradedAppSessionCookie, 'persisted-across-platform-upgrade', true);
      const backups: ResourceBackupListResponse = await cli.runJson(
        `resource backup list --project ${app.projectName} --resource ${app.resourceName}`,
        resourceBackupListResponseSchema,
      );
      expect(backups.backups.map((candidate: ResourceBackupSummary): string => candidate.id)).toContain(
        backup.backup.id,
      );

      await cli.runJson(`${installCommand} --values ${currentValuesPath}`, installResponseSchema);
      expect(await readHelmRevision()).toBe(upgradedRevision);
    },
    upgradeTimeoutMs,
  );

  async function setSensitiveFixtureValue(): Promise<void> {
    const sensitiveVariable: VariableResponse = await cli.runJson(
      `variable set DIRECT_FLAG --sensitive --stdin --env ${app.environmentName}`,
      variableResponseSchema,
      { cwd: app.directory, input: 'encrypted-upgrade-secret\n' },
    );
    expect(sensitiveVariable.variable.valueHidden).toBe(true);
    await cli.runJson(
      `variable set E2E_BUILD_MESSAGE upgrade-gate --env ${app.environmentName}`,
      variableResponseSchema,
      { cwd: app.directory },
    );
  }
});

function buildInstallCommand(adminEmail: string): string {
  return `install --api-url ${platformApiUrl} --base-domain ${platformBaseDomain} --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name ${releaseName} --email ${adminEmail} --organization "Upgrade Gate" --organization-slug upgrade-gate`;
}

async function readHelmRevision(): Promise<number> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'helm',
      'list',
      '--namespace',
      platformNamespace,
      '--kube-context',
      platformKubeContext,
      '--filter',
      `^${releaseName}$`,
      '--output',
      'json',
    ],
    timeoutMs: 60_000,
  });
  expectSuccessfulCommand(result, 'list the Helm release');
  const releases: HelmListReleaseOutput[] = JSON.parse(result.stdout) as HelmListReleaseOutput[];
  const release: HelmListReleaseOutput | undefined = releases[0];
  expect(release?.status).toBe('deployed');
  const revision: number = Number.parseInt(release?.revision ?? '', 10);
  if (!Number.isSafeInteger(revision)) {
    throw new Error('Expected Helm list to include a numeric release revision.');
  }
  return revision;
}

async function expectCurrentPlatformImages(): Promise<void> {
  const values: PlatformImageValues = parse(await readFile(currentValuesPath, 'utf8')) as PlatformImageValues;
  for (const [component, imageKey] of [
    ['api', 'api'],
    ['caddy', 'caddy'],
    ['edge', 'edge'],
    ['registry-auth', 'worker'],
    ['worker', 'worker'],
  ] as const) {
    const expectedImage: PlatformImageValue | undefined = values.images?.[imageKey];
    if (expectedImage?.repository === undefined || expectedImage.digest === undefined) {
      throw new Error(`Missing current ${imageKey} image values.`);
    }
    const result: SelfHostedUserSetupCommandResult = await kubectl([
      '--namespace',
      platformNamespace,
      'get',
      'deployment',
      `${releaseName}-compartment-${component}`,
      '--output=jsonpath={.spec.template.spec.containers[0].image}',
    ]);
    expect(result.stdout.trim()).toBe(`${expectedImage.repository}@${expectedImage.digest}`);
  }
}

async function expectRemovedBuildkitObjectsAbsent(): Promise<void> {
  const buildNamespace: string = `${platformNamespace}-build`;
  for (const [resource, name] of [
    ['deployment', `${releaseName}-compartment-buildkit`],
    ['networkpolicy', `${releaseName}-compartment-buildkit`],
    ['networkpolicy', `${releaseName}-compartment-buildkit-prune`],
    ['cronjob', `${releaseName}-compartment-buildkit-prune`],
  ] as const) {
    const result: SelfHostedUserSetupCommandResult = await kubectl([
      '--namespace',
      buildNamespace,
      'get',
      resource,
      name,
      '--ignore-not-found',
      '--output=name',
    ]);
    expect(result.stdout.trim()).toBe('');
  }
}

async function kubectl(args: readonly string[]): Promise<SelfHostedUserSetupCommandResult> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['kubectl', '--context', platformKubeContext, ...args],
    timeoutMs: 60_000,
  });
  expectSuccessfulCommand(result, `kubectl ${args.join(' ')}`);
  return result;
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tempRootDirectory, prefix));
  createdDirectories.push(directory);
  return directory;
}

function requireEnvironment(name: string): string {
  const value: string | undefined = process.env[name];
  if (value === undefined || value.trim() === '') {
    return `/missing-${name.toLowerCase()}`;
  }
  return value;
}

function splitCommandLine(command: string): string[] {
  return (
    command.match(/(?:[^\s"]+|"[^"]*")+/gu)?.map((argument: string): string => argument.replace(/^"|"$/gu, '')) ?? []
  );
}
