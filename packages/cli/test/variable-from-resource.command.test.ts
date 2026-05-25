import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createCliConfigFixture } from './cli-test.fixtures';
import { expectCliFailure, runCliCommand, type CliCommandResult } from './cli-test.harness';

describe.sequential('compartment variable resource output bindings', (): void => {
  let configDirectory: string;
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(async (): Promise<void> => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'compartment-variable-output-'));
    configDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-config-'));
    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
    await writeCliConfig(configDirectory);
  });

  afterEach(async (): Promise<void> => {
    process.chdir(originalCwd);
    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    vi.unstubAllGlobals();
    await rm(tempRoot, { force: true, recursive: true });
    await rm(configDirectory, { force: true, recursive: true });
  });

  it('validates resource output binding targets before sending requests', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot);
    const fetchMock: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const withoutService: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'DATABASE_URL',
      '--from-resource',
      'postgres.connection-url',
    ]);
    const missingOutput: CliCommandResult = await runCliCommand([
      'variable',
      'set',
      'DATABASE_URL',
      '--service',
      'web',
      '--from-resource',
      'postgres.missing-url',
    ]);

    expectCliFailure(withoutService, '--from-resource requires --service.');
    expectCliFailure(
      missingOutput,
      'Output "missing-url" is not declared in local compartment.yml under resources.postgres.outputs.missing-url.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function writeCliConfig(configDirectory: string): Promise<void> {
  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    join(configDirectory, 'config.json'),
    `${JSON.stringify(createCliConfigFixture(), null, 2)}\n`,
    'utf8',
  );
}

async function createProjectDirectory(tempRoot: string): Promise<string> {
  const projectDirectory: string = join(tempRoot, 'billing');
  await mkdir(projectDirectory);
  await writeFile(
    join(projectDirectory, 'compartment.yml'),
    `name: billing

resources:
  postgres:
    image: postgres:16
    outputs:
      connection-url:
        sensitive: true
        value: postgres://\${resource.host}/\${env.POSTGRES_DB}

services:
  web: .
`,
    'utf8',
  );
  return projectDirectory;
}
