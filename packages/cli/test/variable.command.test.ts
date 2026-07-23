import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createErrorResponse,
  importVariablesResponseSchema,
  variableResponseSchema,
  type VariableDetail,
  type EnvironmentSummary,
  type ImportVariablesResponse,
  type ProjectSummary,
  type VariableListItem,
  type VariableListResponse,
  type VariableLocalRunItem,
  type VariableLocalRunResponse,
  type VariableResponse,
  type VariableScopeType,
  type VariableSensitivity,
  type VariableSourceType,
} from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import {
  createCliConfigFixture,
  createEnvironmentSummaryFixture,
  createProjectSummaryFixture,
} from './cli-test.fixtures';
import {
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
  type CliCommandCapture,
  type CliCommandResult,
  type CliJsonResult,
} from './cli-test.harness';

interface CreateVariableLocalRunResponseInput {
  resourceName?: string | null | undefined;
  serviceName?: string | null | undefined;
  variables?: VariableLocalRunItem[] | undefined;
}

interface CreateProjectDirectoryOptions {
  declaresResource?: boolean | undefined;
}

interface VariableListItemFixtureInput {
  keyName: string;
  scopeResourceName: string | null;
  scopeServiceName: string | null;
  scopeType: VariableScopeType;
  sensitivity: VariableSensitivity;
  sourceResourceOutput?: string | null | undefined;
  sourceType: VariableSourceType;
  sourceVariableSetName: string | null;
}

interface VariableResponseFixtureInput {
  environment?: EnvironmentSummary | undefined;
  project?: ProjectSummary | undefined;
}

describe.sequential('compartment variable commands', { timeout: 15_000 }, (): void => {
  let configDirectory: string;
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(async (): Promise<void> => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'compartment-variable-'));
    configDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-config-'));
    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
    await writeCliConfig(configDirectory);
  });

  afterEach(async (): Promise<void> => {
    process.chdir(originalCwd);
    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    restoreCliCommandModules(['../src/services/variable-run-child-process.service']);
    await rm(tempRoot, { force: true, recursive: true });
    await rm(configDirectory, { force: true, recursive: true });
  });

  it('renders effective provenance for service-target variable lists', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(
              buildVariableListResponse('worker', [
                buildEnvironmentDirectVariable('DATABASE_URL', { sourceType: 'inherited' }),
                buildServiceDirectVariable('QUEUE_TOKEN', 'worker'),
              ]),
            ),
            { headers: { 'Content-Type': 'application/json' }, status: 200 },
          ),
        ),
    );
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'list', '--service', 'worker']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Project: billing');
    expect(readCliStdout(result.capture)).toContain('Environment: production');
    expect(readCliStdout(result.capture)).toContain('Target: service worker');
    expect(readCliStdout(result.capture)).toContain('DATABASE_URL');
    expect(readCliStdout(result.capture)).toContain('inherited');
    expect(readCliStdout(result.capture)).toContain('production/*');
    expect(readCliStdout(result.capture)).toContain('QUEUE_TOKEN');
    expect(readCliStdout(result.capture)).toContain('production/worker');
  });

  it('prints API error details and exits non-zero when a variable request fails', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const apiErrorMessage: string = 'Variable "BROKEN_VALUE" cannot be decrypted.';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createErrorResponse('invalid_deploy_config', apiErrorMessage)), {
          headers: { 'Content-Type': 'application/json' },
          status: 400,
        }),
      ),
    );
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'list']);

    expect(result.exitCode).toBe(1);
    expect(readCliStdout(result.capture)).toBe('');
    expect(readCliStderr(result.capture)).toContain(apiErrorMessage);
    expect(readCliStderr(result.capture)).not.toBe('An unexpected error occurred.\n');
  });

  it('renders environment inventory with service-scoped variants in default lists', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(
              buildVariableListResponse(null, [
                buildEnvironmentDirectVariable('LOG_LEVEL'),
                buildServiceDirectVariable('LOG_LEVEL', 'worker'),
              ]),
            ),
            { headers: { 'Content-Type': 'application/json' }, status: 200 },
          ),
        ),
    );
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'list']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Target: environment');
    expect(readCliStdout(result.capture)).toContain('LOG_LEVEL');
    expect(readCliStdout(result.capture)).toContain('production/*');
    expect(readCliStdout(result.capture)).toContain('production/worker');
  });

  it('shows plain values and targets a non-default environment when requested', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = vi.fn().mockImplementation(async (input: string | URL): Promise<Response> => {
      const requestUrl: URL = new URL(String(input));
      const isExpectedRequest: boolean =
        requestUrl.pathname === '/v1/variables/LOG_LEVEL' &&
        requestUrl.searchParams.get('projectName') === 'billing' &&
        requestUrl.searchParams.get('environmentName') === 'staging';

      return await Promise.resolve(
        new Response(
          JSON.stringify(
            buildEnvironmentVariableResponse(buildPlainValueVariableDetail('LOG_LEVEL', 'debug'), {
              environment: buildEnvironmentSummary('staging'),
            }),
          ),
          { headers: { 'Content-Type': 'application/json' }, status: isExpectedRequest ? 200 : 400 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliJsonResult<VariableResponse> = await runCliJson(
      ['variable', 'show', 'LOG_LEVEL', '--env', 'staging', '--output', 'json'],
      variableResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.environment.name).toBe('staging');
    expect(result.payload.variable.value).toBe('debug');
  });

  it('renders group provenance labels for set-backed variable reads', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(
              buildEnvironmentVariableResponse(buildSetBackedVariableDetail('DATABASE_URL', 'postgres-prod')),
            ),
            { headers: { 'Content-Type': 'application/json' }, status: 200 },
          ),
        ),
    );
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'show', 'DATABASE_URL']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('SOURCE: group:postgres-prod');
  });

  it('reads sensitive values from stdin without exposing them in the request target defaults', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = vi
      .fn()
      .mockImplementation(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
        const body: Record<string, VariableRequestFieldValue> = readJsonRequestBody(init);
        const isExpectedRequest: boolean =
          body.keyName === 'DATABASE_URL' &&
          body.projectName === 'billing' &&
          body.sensitivity === 'sensitive' &&
          body.value === 'postgres://stdin-value' &&
          !('environmentName' in body);

        return await Promise.resolve(
          new Response(
            JSON.stringify(buildEnvironmentVariableResponse(buildHiddenSensitiveVariableDetail('DATABASE_URL'))),
            { headers: { 'Content-Type': 'application/json' }, status: isExpectedRequest ? 200 : 400 },
          ),
        );
      });
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('postgres://stdin-value\n');
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliJsonResult<VariableResponse> = await runCliJson(
      ['variable', 'set', 'DATABASE_URL', '--sensitive', '--stdin', '--output', 'json'],
      variableResponseSchema,
      capture,
    );

    expectCliSuccess(result);
    expect(result.payload.variable.valueHidden).toBe(true);
  });

  it.each([
    ['GREETING=privet', 'GREETING', 'privet'],
    ['TOKEN=a=b=c', 'TOKEN', 'a=b=c'],
  ])(
    'accepts KEY=VALUE syntax and splits only the first equals sign: %s',
    async (argument: string, expectedKey: string, expectedValue: string): Promise<void> => {
      const projectDirectory: string = await createProjectDirectory(tempRoot);
      const fetchMock: Mock = vi
        .fn()
        .mockImplementation(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
          const body: Record<string, VariableRequestFieldValue> = readJsonRequestBody(init);
          const isExpectedRequest: boolean = body.keyName === expectedKey && body.value === expectedValue;
          return await Promise.resolve(
            new Response(
              JSON.stringify(
                buildEnvironmentVariableResponse(buildPlainValueVariableDetail(expectedKey, expectedValue)),
              ),
              { headers: { 'Content-Type': 'application/json' }, status: isExpectedRequest ? 200 : 400 },
            ),
          );
        });
      vi.stubGlobal('fetch', fetchMock);
      process.chdir(projectDirectory);

      const result: CliCommandResult = await runCliCommand(['variable', 'set', argument]);

      expectCliSuccess(result);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('shows both supported forms when a variable value is missing', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'set', 'GREETING']);

    expectCliFailure(result, 'variable set GREETING VALUE');
    expect(readCliStderr(result.capture)).toContain('variable set GREETING=VALUE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects resource and service target ambiguity before sending requests', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'POSTGRES_PASSWORD',
      'secret',
      '--resource',
      'postgres',
      '--service',
      'web',
    ]);

    expectCliFailure(result, 'Pass either --service or --resource, not both.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a declared resource variable target before first deploy', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const apiReachedMessage: string = 'resource variable API reached after local descriptor validation';
    const fetchMock: Mock = createRejectingFetchMock(apiReachedMessage);
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'POSTGRES_PASSWORD',
      'secret',
      '--resource',
      'postgres',
    ]);

    expectCliFailure(result, 'POST /v1/variables failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a declared resource variable target for a matching explicit project', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const apiReachedMessage: string = 'resource variable API reached after selected project validation';
    const fetchMock: Mock = createRejectingFetchMock(apiReachedMessage);
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'POSTGRES_PASSWORD',
      'secret',
      '--project',
      'billing',
      '--resource',
      'postgres',
    ]);

    expectCliFailure(result, 'POST /v1/variables failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects resource variable targets when the local descriptor is for a different selected project', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'POSTGRES_PASSWORD',
      'secret',
      '--project',
      'invoices',
      '--resource',
      'postgres',
    ]);

    expectCliFailure(
      result,
      '--resource postgres with --project invoices requires local compartment.yml for project invoices, but found project billing.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a misspelled resource variable target before sending requests', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'POSTGRES_PASSWORD',
      'secret',
      '--resource',
      'postgrez',
    ]);

    expectCliFailure(result, 'Resource "postgrez" is not declared in local compartment.yml under resources.postgrez.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a local descriptor for resource variable writes before sending requests', async (): Promise<void> => {
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(tempRoot);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'POSTGRES_PASSWORD',
      'secret',
      '--resource',
      'postgres',
    ]);

    expectCliFailure(result, '--resource postgres requires a local compartment.yml descriptor.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows removing resource variables for resources no longer declared locally', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = createRejectingFetchMock('resource variable cleanup API reached');
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'remove',
      'POSTGRES_PASSWORD',
      '--resource',
      'deleted-resource',
    ]);

    expectCliFailure(
      result,
      'DELETE /v1/variables/POSTGRES_PASSWORD?projectName=billing&resourceName=deleted-resource failed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows unbinding resource variable groups for resources no longer declared locally', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = createRejectingFetchMock('resource variable group cleanup API reached');
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'unbind',
      'postgres-prod',
      '--resource',
      'deleted-resource',
    ]);

    expectCliFailure(
      result,
      'DELETE /v1/variables/bindings/postgres-prod?projectName=billing&resourceName=deleted-resource failed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects imported resource variables for misspelled resource targets before sending requests', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'import',
      '--file',
      '.env',
      '--resource',
      'postgrez',
    ]);

    expectCliFailure(result, 'Resource "postgrez" is not declared in local compartment.yml under resources.postgrez.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects binding resource variable groups for misspelled resource targets before sending requests', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'bind',
      'postgres-prod',
      '--resource',
      'postgrez',
    ]);

    expectCliFailure(result, 'Resource "postgrez" is not declared in local compartment.yml under resources.postgrez.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects resource variable group captures for misspelled resource targets before sending requests', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'group',
      'capture',
      'postgres-prod',
      '--resource',
      'postgrez',
    ]);

    expectCliFailure(result, 'Resource "postgrez" is not declared in local compartment.yml under resources.postgrez.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps service-target variable scope creation on the existing path', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const apiReachedMessage: string = 'service variable API reached without resource descriptor validation';
    const fetchMock: Mock = createRejectingFetchMock(apiReachedMessage);
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'QUEUE_TOKEN',
      'secret',
      '--service',
      'worker',
    ]);

    expectCliFailure(result, 'POST /v1/variables failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails before sending a request when a sensitive value is passed positionally', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'DATABASE_URL',
      'postgres://from-argv',
      '--sensitive',
    ]);

    expectCliFailure(result, 'Sensitive variables must use hidden prompt input or --stdin.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails before sending a request when a value and --stdin are passed together', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = vi.fn();
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('postgres://stdin-value\n');
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(
      ['variable', 'set', 'DATABASE_URL', 'postgres://from-argv', '--stdin'],
      capture,
    );

    expectCliFailure(result, 'Pass either a value or --stdin, not both.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows hidden placeholders for sensitive variable reads', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(buildEnvironmentVariableResponse(buildHiddenSensitiveVariableDetail('DATABASE_URL'))),
            { headers: { 'Content-Type': 'application/json' }, status: 200 },
          ),
        ),
    );
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'show', 'DATABASE_URL']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('CLASS: sensitive');
    expect(readCliStdout(result.capture)).toContain('VALUE: <hidden>');
  });

  it('imports multiline quoted dotenv values without duplicate-key false positives', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    await writeFile(
      join(projectDirectory, '.env.multiline'),
      'PRIVATE_KEY="line1\nLOG_LEVEL=debug\nline3"\nDATABASE_URL=postgres://db\n',
      'utf8',
    );
    const fetchMock: Mock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(buildEnvironmentImportVariablesResponse(['PRIVATE_KEY', 'DATABASE_URL'])), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliJsonResult<ImportVariablesResponse> = await runCliJson(
      ['variable', 'import', '--file', '.env.multiline', '--output', 'json'],
      importVariablesResponseSchema,
    );

    expectCliSuccess(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails before sending a request when the dotenv file contains duplicate keys', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    await writeFile(join(projectDirectory, '.env.duplicate'), 'LOG_LEVEL=info\nLOG_LEVEL=debug\n', 'utf8');
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'import', '--file', '.env.duplicate']);

    expectCliFailure(result, 'Duplicate imported variable keys');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails production variable runs before API disclosure when allow-production is absent', async (): Promise<void> => {
    resetCliCommandModules();
    const runChildMock: Mock<RunVariableChildCommand> = mockVariableChildRunner({
      exitCode: 0,
      stderr: '',
      stdout: '',
    });
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'run', '--env', 'production', '--', 'node']);

    expectCliFailure(result, 'Pass --allow-production to run a local command with production variables.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runChildMock).not.toHaveBeenCalled();
  });

  it('cancels production variable runs before API disclosure when the prompt is rejected', async (): Promise<void> => {
    resetCliCommandModules();
    const runChildMock: Mock<RunVariableChildCommand> = mockVariableChildRunner({
      exitCode: 0,
      stderr: '',
      stdout: '',
    });
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    const fetchMock: Mock = vi.fn();
    capture.stdin.end('n\n');
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(
      ['variable', 'run', '--env', 'production', '--allow-production', '--', 'node'],
      capture,
    );

    expectCliFailure(result, 'Production variable run cancelled.');
    expect(readCliStderr(result.capture)).toContain(
      'Run command with production variables for project billing, environment production? [y/N]:',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runChildMock).not.toHaveBeenCalled();
  });

  it('confirms production variable runs before sending productionAck to the API', async (): Promise<void> => {
    resetCliCommandModules();
    const runChildMock: Mock<RunVariableChildCommand> = mockVariableChildRunner({
      exitCode: 0,
      stderr: '',
      stdout: '',
    });
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    const fetchMock: Mock = vi
      .fn()
      .mockImplementation(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
        const body: Record<string, VariableRequestFieldValue> = readJsonRequestBody(init);
        const isExpectedRequest: boolean =
          body.environmentName === 'production' && body.productionAck === true && body.serviceName === 'worker';

        return await Promise.resolve(
          new Response(JSON.stringify(createVariableLocalRunResponse({ serviceName: 'worker' })), {
            headers: { 'Content-Type': 'application/json' },
            status: isExpectedRequest ? 200 : 400,
          }),
        );
      });
    capture.stdin.end('yes\n');
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(
      ['variable', 'run', '--env', 'production', '--service', 'worker', '--allow-production', '--', 'node'],
      capture,
    );

    expectCliSuccess(result);
    expect(readCliStderr(result.capture)).toContain(
      'Run command with production variables for project billing, environment production service worker? [y/N]:',
    );
    expect(runChildMock).toHaveBeenCalledTimes(1);
  });

  it('requires the command separator directly before local-run child arguments', async (): Promise<void> => {
    resetCliCommandModules();
    const runChildMock: Mock<RunVariableChildCommand> = mockVariableChildRunner({
      exitCode: 0,
      stderr: '',
      stdout: '',
    });
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'run', 'node']);
    const positionalBeforeSeparatorResult: CliCommandResult = await runCliCommand([
      'variable',
      'run',
      'node',
      '--',
      '--flag',
    ]);
    const emptyChildResult: CliCommandResult = await runCliCommand(['variable', 'run', '--']);

    expectCliFailure(result, 'Use -- before the command to run.');
    expectCliFailure(positionalBeforeSeparatorResult, 'Use -- before the command to run.');
    expectCliFailure(emptyChildResult, 'Pass a command after --.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runChildMock).not.toHaveBeenCalled();
  });

  it('rejects resource variable runs for misspelled resource targets before API or child execution', async (): Promise<void> => {
    resetCliCommandModules();
    const runChildMock: Mock<RunVariableChildCommand> = mockVariableChildRunner({
      exitCode: 0,
      stderr: '',
      stdout: '',
    });
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'run', '--resource', 'postgrez', '--', 'node']);

    expectCliFailure(result, 'Resource "postgrez" is not declared in local compartment.yml under resources.postgrez.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runChildMock).not.toHaveBeenCalled();
  });

  it('runs resource variables for a declared resource in the selected local project', async (): Promise<void> => {
    resetCliCommandModules();
    const runChildMock: Mock<RunVariableChildCommand> = mockVariableChildRunner({
      exitCode: 0,
      stderr: '',
      stdout: '',
    });
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const fetchMock: Mock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createVariableLocalRunResponse({ resourceName: 'postgres' })), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'run',
      '--resource',
      'postgres',
      '--project',
      'billing',
      '--',
      'node',
    ]);

    expectCliSuccess(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runChildMock).toHaveBeenCalledTimes(1);
  });

  it('rejects resource variable runs when the selected project differs from the local descriptor', async (): Promise<void> => {
    resetCliCommandModules();
    const runChildMock: Mock<RunVariableChildCommand> = mockVariableChildRunner({
      exitCode: 0,
      stderr: '',
      stdout: '',
    });
    const projectDirectory: string = await createProjectDirectory(tempRoot, { declaresResource: true });
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'variable',
      'run',
      '--resource',
      'postgres',
      '--project',
      'other',
      '--',
      'node',
    ]);

    expectCliFailure(
      result,
      '--resource postgres with --project other requires local compartment.yml for project other, but found project billing.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runChildMock).not.toHaveBeenCalled();
  });

  it('uses stderr for empty local-run warnings and propagates the child exit code', async (): Promise<void> => {
    resetCliCommandModules();
    mockVariableChildRunner({
      exitCode: 7,
      stderr: '',
      stdout: '',
    });
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createVariableLocalRunResponse({ variables: [] })), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      ),
    );
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['variable', 'run', '--', 'node']);

    expect(result.exitCode).toBe(7);
    expect(readCliStderr(result.capture)).toContain('No compartment variables were injected');
    expect(readCliStdout(result.capture)).toBe('');
  });
});

type RunVariableChildCommand = (command: readonly string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>;
type VariableRequestFieldValue = boolean | string;

function createRejectingFetchMock(message: string): Mock {
  return vi.fn().mockRejectedValue(new Error(message));
}

async function writeCliConfig(configDirectory: string): Promise<void> {
  await writeFile(
    join(configDirectory, 'config.json'),
    `${JSON.stringify(createCliConfigFixture(), null, 2)}\n`,
    'utf8',
  );
}

async function createProjectDirectory(tempRoot: string, options: CreateProjectDirectoryOptions = {}): Promise<string> {
  const projectDirectory: string = join(tempRoot, 'billing');
  await mkdir(projectDirectory);
  await writeFile(
    join(projectDirectory, 'compartment.yml'),
    `name: billing

${buildProjectDirectoryResourceBlock(options)}

services:
  web: .
  worker:
    kind: worker
    path: ./worker
`,
    'utf8',
  );
  return projectDirectory;
}

function buildProjectDirectoryResourceBlock(options: CreateProjectDirectoryOptions): string {
  if (options.declaresResource === true) {
    return 'resources:\n  postgres:\n    image: postgres:16\n\n';
  }

  return '';
}

function buildEnvironmentSummary(environmentName: string): EnvironmentSummary {
  return createEnvironmentSummaryFixture({
    createdAt: '2026-04-07T10:00:00.000Z',
    id: `env_${environmentName}`,
    name: environmentName,
    projectId: 'prj_billing',
    updatedAt: '2026-04-07T10:00:00.000Z',
  });
}

function buildProjectSummary(projectName: string): ProjectSummary {
  return createProjectSummaryFixture({
    createdAt: '2026-04-07T10:00:00.000Z',
    id: 'prj_billing',
    name: projectName,
    organizationId: 'org_123',
    updatedAt: '2026-04-07T10:00:00.000Z',
  });
}

function readJsonRequestBody(init?: RequestInit): Record<string, VariableRequestFieldValue> {
  const requestBody: string = typeof init?.body === 'string' && init.body.length > 0 ? init.body : '{}';
  return JSON.parse(requestBody) as Record<string, VariableRequestFieldValue>;
}

function mockVariableChildRunner(
  result: CommandResult,
  onRun?: (env: NodeJS.ProcessEnv) => void,
): Mock<RunVariableChildCommand> {
  const runChildMock: Mock<RunVariableChildCommand> = vi
    .fn<RunVariableChildCommand>()
    .mockImplementation(async (_command: readonly string[], env: NodeJS.ProcessEnv): Promise<CommandResult> => {
      onRun?.(env);
      return await Promise.resolve(result);
    });
  vi.doMock(
    '../src/services/variable-run-child-process.service',
    (): { runVariableChildCommand: Mock<RunVariableChildCommand> } => ({
      runVariableChildCommand: runChildMock,
    }),
  );

  return runChildMock;
}

function createVariableLocalRunResponse(input: CreateVariableLocalRunResponseInput = {}): VariableLocalRunResponse {
  return {
    accessEventId: 'vae_123',
    environment: createEnvironmentSummaryFixture({
      createdAt: '2026-04-07T10:00:00.000Z',
      id: 'env_development',
      name: 'development',
      projectId: 'prj_billing',
      updatedAt: '2026-04-07T10:00:00.000Z',
    }),
    project: createProjectSummaryFixture({
      createdAt: '2026-04-07T10:00:00.000Z',
      id: 'prj_billing',
      name: 'billing',
      organizationId: 'org_123',
      updatedAt: '2026-04-07T10:00:00.000Z',
    }),
    resourceName: input.resourceName ?? null,
    serviceName: input.serviceName ?? null,
    variables: input.variables ?? [
      buildVariableLocalRunItem('DATABASE_URL', 'postgres://local', {
        sensitivity: 'sensitive',
        valueFingerprint: 'a'.repeat(64),
      }),
      buildVariableLocalRunItem('LOG_LEVEL', 'debug', {
        valueFingerprint: 'b'.repeat(64),
      }),
    ],
  };
}

function buildVariableListResponse(serviceName: string | null, variables: VariableListItem[]): VariableListResponse {
  return {
    environment: buildEnvironmentSummary('production'),
    project: buildProjectSummary('billing'),
    resourceName: null,
    serviceName,
    variables,
  };
}

function buildEnvironmentVariableResponse(
  variable: VariableDetail,
  input: VariableResponseFixtureInput = {},
): VariableResponse {
  return {
    environment: input.environment ?? buildEnvironmentSummary('production'),
    project: input.project ?? buildProjectSummary('billing'),
    resourceName: null,
    serviceName: null,
    variable,
  };
}

function buildEnvironmentImportVariablesResponse(importedKeyNames: string[]): ImportVariablesResponse {
  return {
    environment: buildEnvironmentSummary('production'),
    importedKeyNames,
    project: buildProjectSummary('billing'),
    resourceName: null,
    serviceName: null,
  };
}

function buildEnvironmentDirectVariable(keyName: string, overrides: Partial<VariableListItem> = {}): VariableListItem {
  return buildVariableListItem({
    keyName,
    scopeResourceName: null,
    scopeServiceName: null,
    scopeType: 'environment',
    sensitivity: 'plain',
    sourceType: 'direct',
    sourceVariableSetName: null,
    ...overrides,
  });
}

function buildServiceDirectVariable(
  keyName: string,
  serviceName: string,
  overrides: Partial<VariableListItem> = {},
): VariableListItem {
  return buildVariableListItem({
    keyName,
    scopeResourceName: null,
    scopeServiceName: serviceName,
    scopeType: 'service',
    sensitivity: 'plain',
    sourceType: 'direct',
    sourceVariableSetName: null,
    ...overrides,
  });
}

function buildPlainValueVariableDetail(
  keyName: string,
  value: string,
  overrides: Partial<VariableDetail> = {},
): VariableDetail {
  return {
    ...buildEnvironmentDirectVariable(keyName),
    value,
    valueHidden: false,
    ...overrides,
  };
}

function buildHiddenSensitiveVariableDetail(keyName: string, overrides: Partial<VariableDetail> = {}): VariableDetail {
  return {
    ...buildEnvironmentDirectVariable(keyName, { sensitivity: 'sensitive' }),
    value: null,
    valueHidden: true,
    ...overrides,
  };
}

function buildSetBackedVariableDetail(
  keyName: string,
  sourceVariableSetName: string,
  overrides: Partial<VariableDetail> = {},
): VariableDetail {
  return {
    ...buildEnvironmentDirectVariable(keyName, {
      sensitivity: 'sensitive',
      sourceType: 'set',
      sourceVariableSetName,
    }),
    value: null,
    valueHidden: true,
    ...overrides,
  };
}

function buildVariableListItem(input: VariableListItemFixtureInput): VariableListItem {
  return {
    ...input,
    sourceResourceOutput: input.sourceResourceOutput ?? null,
  };
}

function buildVariableLocalRunItem(
  keyName: string,
  value: string,
  overrides: Partial<VariableLocalRunItem> = {},
): VariableLocalRunItem {
  return {
    ...buildEnvironmentDirectVariable(keyName, { sensitivity: 'plain' }),
    value,
    valueFingerprint: 'a'.repeat(64),
    ...overrides,
  };
}
