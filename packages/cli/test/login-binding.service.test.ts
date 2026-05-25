import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { persistLoginBindingIfNeeded } from '../src/commands/auth/login-binding.service';
import type { CommandResult } from '../src/command-runner.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import { type CliCommandCapture, createCliCapture, readCliStderr } from './cli-test.harness';

const createdDirectories: string[] = [];

describe('login binding service', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      createdDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('stores a new binding at the Git root by default', async (): Promise<void> => {
    const repositoryRoot: string = await createTempDirectory('compartment-login-binding-');
    const cwd: string = join(repositoryRoot, 'apps/web/src');

    await writeFile(join(repositoryRoot, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await mkdir(cwd, { recursive: true });
    await writeFile(join(repositoryRoot, 'apps/web/compartment.yml'), 'name: web\nservices:\n  web: .\n', 'utf8');

    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('\n\n');

    await persistLoginBindingIfNeeded({
      config: createCliConfigFixture({
        currentRemote: 'lab',
        remotes: {
          lab: {
            apiUrl: 'https://lab.example.com',
            sessionToken: 'lab-session',
          },
        },
      }),
      cwd,
      io: capture.io,
      output: 'text',
      remoteName: 'lab',
    });

    await expect(readFile(join(repositoryRoot, '.compartment/state.json'), 'utf8')).resolves.toContain(
      '"selectedRemote": "lab"',
    );
    await expect(readFile(join(repositoryRoot, 'apps/web/.compartment/state.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('stores a new binding at the project root when selected', async (): Promise<void> => {
    const repositoryRoot: string = await createTempDirectory('compartment-login-binding-');
    const projectRoot: string = join(repositoryRoot, 'apps/web');
    const cwd: string = join(projectRoot, 'src');

    await writeFile(join(repositoryRoot, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await mkdir(cwd, { recursive: true });
    await writeFile(join(projectRoot, 'compartment.yml'), 'name: web\nservices:\n  web: .\n', 'utf8');

    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('y\nproject-root\n');

    await persistLoginBindingIfNeeded({
      config: createCliConfigFixture({
        currentRemote: 'lab',
        remotes: {
          lab: {
            apiUrl: 'https://lab.example.com',
            sessionToken: 'lab-session',
          },
        },
      }),
      cwd,
      io: capture.io,
      output: 'text',
      remoteName: 'lab',
    });

    await expect(readFile(join(projectRoot, '.compartment/state.json'), 'utf8')).resolves.toContain(
      '"selectedRemote": "lab"',
    );
    await expect(readFile(join(repositoryRoot, '.compartment/state.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('repairs a broken saved binding', async (): Promise<void> => {
    const repositoryRoot: string = await createTempDirectory('compartment-login-binding-');
    const projectRoot: string = join(repositoryRoot, 'apps/web');
    const cwd: string = join(projectRoot, 'src');

    await writeFile(join(repositoryRoot, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await mkdir(join(projectRoot, '.compartment'), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(projectRoot, 'compartment.yml'), 'name: web\nservices:\n  web: .\n', 'utf8');
    await writeFile(
      join(projectRoot, '.compartment/state.json'),
      `${JSON.stringify({ selectedRemote: 'missing' }, null, 2)}\n`,
      'utf8',
    );

    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('\n');

    await persistLoginBindingIfNeeded({
      config: createCliConfigFixture({
        currentRemote: 'lab',
        remotes: {
          lab: {
            apiUrl: 'https://lab.example.com',
            sessionToken: 'lab-session',
          },
        },
      }),
      cwd,
      io: capture.io,
      output: 'text',
      remoteName: 'lab',
    });

    await expect(readFile(join(projectRoot, '.compartment/state.json'), 'utf8')).resolves.toBe(
      '{\n  "selectedRemote": "lab"\n}\n',
    );
  });

  it('warns when the chosen state file is Git-tracked', async (): Promise<void> => {
    const repositoryRoot: string = await createTempDirectory('compartment-login-binding-');
    const cwd: string = join(repositoryRoot, 'apps/web');

    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, 'compartment.yml'), 'name: web\nservices:\n  web: .\n', 'utf8');

    await initializeGitRepository(repositoryRoot);
    await mkdir(join(repositoryRoot, '.compartment'), { recursive: true });
    await writeFile(join(repositoryRoot, '.compartment/state.json'), '{\n  "selectedRemote": "old"\n}\n', 'utf8');
    await stageFile(repositoryRoot, '.compartment/state.json');

    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('\n');

    await persistLoginBindingIfNeeded({
      config: createCliConfigFixture({
        currentRemote: 'lab',
        remotes: {
          lab: {
            apiUrl: 'https://lab.example.com',
            sessionToken: 'lab-session',
          },
        },
      }),
      cwd,
      io: capture.io,
      output: 'text',
      remoteName: 'lab',
    });

    expect(readCliStderr(capture)).toContain('.compartment/state.json stores local remote bindings');
  });

  it('warns instead of failing when repo binding state cannot be read', async (): Promise<void> => {
    const repositoryRoot: string = await createTempDirectory('compartment-login-binding-');
    const cwd: string = join(repositoryRoot, 'apps/web/src');

    await writeFile(join(repositoryRoot, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await mkdir(join(repositoryRoot, 'apps/web/.compartment'), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(repositoryRoot, 'apps/web/compartment.yml'), 'name: web\nservices:\n  web: .\n', 'utf8');
    await writeFile(join(repositoryRoot, 'apps/web/.compartment/state.json'), '{invalid json}\n', 'utf8');

    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    capture.stdin.end('\n');

    await expect(
      persistLoginBindingIfNeeded({
        config: createCliConfigFixture({
          currentRemote: 'lab',
          remotes: {
            lab: {
              apiUrl: 'https://lab.example.com',
              sessionToken: 'lab-session',
            },
          },
        }),
        cwd,
        io: capture.io,
        output: 'text',
        remoteName: 'lab',
      }),
    ).resolves.toBeUndefined();

    expect(readCliStderr(capture)).toContain('login succeeded, but the repo binding was not updated');
  });
});

async function createTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}

async function initializeGitRepository(directory: string): Promise<void> {
  const { runCommand } = await import('../src/command-runner');
  const result: CommandResult = await runCommand(['git', '-C', directory, 'init'], process.env);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr !== '' ? result.stderr : 'Failed to initialize Git repository.');
  }
}

async function stageFile(directory: string, filePath: string): Promise<void> {
  const { runCommand } = await import('../src/command-runner');
  const result: CommandResult = await runCommand(['git', '-C', directory, 'add', filePath], process.env);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr !== '' ? result.stderr : `Failed to stage ${filePath}.`);
  }
}
