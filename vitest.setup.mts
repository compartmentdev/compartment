import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliConfigSandboxStateKey: string = '__platformVitestCliConfigSandbox';

applyCliConfigSandbox();

interface CliConfigSandbox {
  cliConfigDirectory: string;
}

function applyCliConfigSandbox(): void {
  const sandbox: CliConfigSandbox = readCliConfigSandbox();

  resetDirectory(sandbox.cliConfigDirectory);

  process.env.COMPARTMENT_CLI_CONFIG_DIR = sandbox.cliConfigDirectory;
}

function readCliConfigSandbox(): CliConfigSandbox {
  const globalState: CliConfigSandboxGlobalState = globalThis as CliConfigSandboxGlobalState;
  const sandbox: CliConfigSandbox | undefined = globalState[cliConfigSandboxStateKey];
  if (sandbox !== undefined) {
    return sandbox;
  }

  const rootDirectory: string = mkdtempSync(join(tmpdir(), 'compartment-vitest-cli-config-'));
  const createdSandbox: CliConfigSandbox = {
    cliConfigDirectory: join(rootDirectory, 'cli-config'),
  };
  globalState[cliConfigSandboxStateKey] = createdSandbox;
  return createdSandbox;
}

function resetDirectory(directory: string): void {
  rmSync(directory, { force: true, recursive: true });
  mkdirSync(directory, { recursive: true });
}

type CliConfigSandboxGlobalState = typeof globalThis & {
  [cliConfigSandboxStateKey]?: CliConfigSandbox;
};
