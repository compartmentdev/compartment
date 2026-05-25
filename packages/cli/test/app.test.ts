import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCliCapture,
  expectCliSuccess,
  readCliStdout,
  runCliCommand,
  type CliCommandCapture,
  type CliCommandResult,
} from './cli-test.harness';

interface CliPackageJson {
  version: string;
}

describe('compartment CLI version output', (): void => {
  it('prints the CLI version and exits successfully', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const result: CliCommandResult = await runCliCommand(['--version'], capture);

    expectCliSuccess(result);
    expect(readCliStdout(capture)).toBe(`${readCliPackageVersion()}\n`);
  });
});

function readCliPackageVersion(): string {
  const packageJsonPath: string = resolve(__dirname, '../package.json');
  const packageJson: CliPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as CliPackageJson;
  return packageJson.version;
}
