import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compartmentInitResultSchema, type CompartmentInitResult } from '@compartment/contracts';
import {
  type CliCommandCapture,
  type CliCommandResult,
  type CliJsonResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStdout,
  readCliStderr,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

describe.sequential('compartment init command', (): void => {
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(async (): Promise<void> => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'compartment-init-'));
  });

  afterEach(async (): Promise<void> => {
    process.chdir(originalCwd);
    await rm(tempRoot, { force: true, recursive: true });
  });

  it('uses the current folder name in non-interactive mode when no name is provided', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'Backoffice App');

    process.chdir(projectDirectory);

    const result: CliJsonResult<CompartmentInitResult> = await runCliJson(
      ['init', '--output', 'json'],
      compartmentInitResultSchema,
    );
    expectCliSuccess(result);

    const payload: CompartmentInitResult = result.payload;
    expect(payload).toEqual({
      descriptor: {
        name: 'backoffice-app',
        services: {
          web: '.',
        },
      },
      file: './compartment.yml',
    });

    const writtenDescriptor: string = await readFile(join(projectDirectory, 'compartment.yml'), 'utf8');
    expect(writtenDescriptor).toBe(`name: backoffice-app\n\nservices:\n  web: .\n`);
  });

  it('uses the explicit --name value in non-interactive mode', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, '123');

    process.chdir(projectDirectory);

    const result: CliJsonResult<CompartmentInitResult> = await runCliJson(
      ['init', '--name', 'backoffice-app', '--output', 'json'],
      compartmentInitResultSchema,
    );
    expectCliSuccess(result);

    const payload: CompartmentInitResult = result.payload;
    expect(payload.descriptor.name).toBe('backoffice-app');
  });

  it('prompts in interactive mode and accepts the suggested folder-based name by default', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'Backoffice App');
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('\n');

    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['init', '--output', 'json'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toContain('Project name [backoffice-app]: ');
  });

  it('prints the descriptor schema hint in text output', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'Backoffice App');

    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['init']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain(
      'Need the full compartment.yml schema? Run: compartment descriptor schema',
    );
  });

  it('prompts in interactive mode even when the folder name is not a valid slug', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, '123');
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('backoffice-app\n');

    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['init', '--output', 'json'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toContain('Project name: ');
  });

  it('fails fast when compartment.yml already exists', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'Backoffice App');
    const descriptorPath: string = join(projectDirectory, 'compartment.yml');
    const originalContents: string = 'name: existing\n\nservices:\n  web: .\n';

    await writeFile(descriptorPath, originalContents, 'utf8');
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['init']);

    expectCliFailure(result, 'compartment.yml already exists in this directory.');
    expect(await readFile(descriptorPath, 'utf8')).toBe(originalContents);
  });

  it('fails in non-interactive mode when neither --name nor a valid folder-derived name exists', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, '123');

    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['init']);

    expectCliFailure(result, 'Could not derive a valid project name from directory "123". Re-run with --name <slug>.');
  });
});

async function createProjectDirectory(parentDirectory: string, directoryName: string): Promise<string> {
  const projectDirectory: string = join(parentDirectory, directoryName);
  await mkdir(projectDirectory);
  return projectDirectory;
}
