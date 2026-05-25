import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CliRemoteListResponse,
  type CliRemoteRemoveResponse,
  type CliRemoteResponse,
} from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCliConfig, writeCliConfig } from '../src/store/config.store';
import { readProjectStateFilePath } from '../src/store/project-state.store';
import {
  type CliCommandResult,
  type CliJsonResult,
  expectCliFailure,
  expectCliSuccess,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';
import {
  cliRemoteListResponseSchema,
  cliRemoteRemoveResponseSchema,
  cliRemoteResponseSchema,
} from './remote-command-response.harness';

const createdDirectories: string[] = [];

describe.sequential('remote commands', (): void => {
  let previousConfigDir: string | undefined;
  let previousCwd: string;

  beforeEach(async (): Promise<void> => {
    previousConfigDir = process.env.COMPARTMENT_CLI_CONFIG_DIR;
    previousCwd = process.cwd();
    process.env.COMPARTMENT_CLI_CONFIG_DIR = await createTempDirectory('compartment-cli-config-');
  });

  afterEach(async (): Promise<void> => {
    process.chdir(previousCwd);
    if (previousConfigDir === undefined) {
      delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    } else {
      process.env.COMPARTMENT_CLI_CONFIG_DIR = previousConfigDir;
    }

    await Promise.all(
      createdDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('lists configured remotes through the CLI JSON contract', async (): Promise<void> => {
    await writeCliConfig({
      currentRemote: 'lab',
      remotes: {
        eu: {
          apiUrl: 'https://eu.example.com',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
        },
      },
    });

    const result: CliJsonResult<CliRemoteListResponse> = await runCliJson(
      ['remote', 'list', '--output', 'json'],
      cliRemoteListResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload).toEqual({
      currentRemote: 'lab',
      remotes: [
        {
          apiUrl: 'https://eu.example.com',
          currentOrganization: null,
          name: 'eu',
        },
        {
          apiUrl: 'https://lab.example.com',
          currentOrganization: null,
          name: 'lab',
        },
      ],
    });
  });

  it('writes repo-local state when selecting a remote in a project', async (): Promise<void> => {
    const cwd: string = await createProjectDirectory();
    await mkdir(join(cwd, '.git'));
    process.chdir(cwd);
    await writeCliConfig({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://default.example.com',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
        },
      },
    });

    const result: CliJsonResult<CliRemoteResponse> = await runCliJson(
      ['remote', 'use', 'lab', '--output', 'json'],
      cliRemoteResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.remote.name).toBe('lab');
    await expect(readFile(readProjectStateFilePath(cwd), 'utf8')).resolves.toContain('"selectedRemote": "lab"');
    await expect(readFile(join(cwd, '.gitignore'), 'utf8')).resolves.toBe('.compartment/state.json\n');
    await expect(readCliConfig()).resolves.toEqual({
      currentRemote: 'lab',
      remotes: {
        default: {
          apiUrl: 'https://default.example.com',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
        },
      },
    });
  });

  it('writes a project override when selecting a remote under a repo-wide binding', async (): Promise<void> => {
    const repositoryRoot: string = await createTempDirectory('compartment-cli-remote-command-');
    const cwd: string = join(repositoryRoot, 'apps', 'web', 'src');
    await writeFile(join(repositoryRoot, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await mkdir(join(repositoryRoot, '.compartment'), { recursive: true });
    await mkdir(join(repositoryRoot, 'apps', 'web', '.compartment'), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(repositoryRoot, 'apps', 'web', '.gitignore'), 'node_modules\n', 'utf8');
    await writeFile(
      join(repositoryRoot, '.compartment', 'state.json'),
      '{\n  "selectedRemote": "default"\n}\n',
      'utf8',
    );
    await writeFile(
      join(repositoryRoot, 'apps', 'web', 'compartment.yml'),
      'name: smoke\nservices:\n  web: .\n',
      'utf8',
    );
    process.chdir(cwd);
    await writeCliConfig({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://default.example.com',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
        },
      },
    });

    const result: CliJsonResult<CliRemoteResponse> = await runCliJson(
      ['remote', 'use', 'lab', '--output', 'json'],
      cliRemoteResponseSchema,
    );

    expectCliSuccess(result);
    await expect(
      readFile(join(repositoryRoot, 'apps', 'web', '.compartment', 'state.json'), 'utf8'),
    ).resolves.toContain('"selectedRemote": "lab"');
    await expect(readFile(join(repositoryRoot, 'apps', 'web', '.gitignore'), 'utf8')).resolves.toBe(
      'node_modules\n.compartment/state.json\n',
    );
    await expect(readFile(join(repositoryRoot, '.compartment', 'state.json'), 'utf8')).resolves.toContain(
      '"selectedRemote": "default"',
    );
  });

  it('updates the Git-root binding when selecting a remote from the repo root', async (): Promise<void> => {
    const repositoryRoot: string = await createTempDirectory('compartment-cli-remote-command-');
    await writeFile(join(repositoryRoot, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await mkdir(join(repositoryRoot, '.compartment'), { recursive: true });
    await writeFile(
      join(repositoryRoot, '.compartment', 'state.json'),
      '{\n  "selectedRemote": "default"\n}\n',
      'utf8',
    );
    process.chdir(repositoryRoot);
    await writeCliConfig({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://default.example.com',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
        },
      },
    });

    const result: CliJsonResult<CliRemoteResponse> = await runCliJson(
      ['remote', 'use', 'lab', '--output', 'json'],
      cliRemoteResponseSchema,
    );

    expectCliSuccess(result);
    await expect(readFile(join(repositoryRoot, '.compartment', 'state.json'), 'utf8')).resolves.toContain(
      '"selectedRemote": "lab"',
    );
  });

  it('fails without writing through a symlinked project state directory', async (): Promise<void> => {
    const workspaceRoot: string = await createTempDirectory('compartment-cli-remote-command-');
    const repositoryRoot: string = join(workspaceRoot, 'repo');
    const outsideRoot: string = join(workspaceRoot, 'outside');

    await mkdir(repositoryRoot);
    await mkdir(outsideRoot);
    await writeFile(join(repositoryRoot, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await writeFile(join(repositoryRoot, 'compartment.yml'), 'name: smoke\nservices:\n  web: .\n', 'utf8');
    await symlink(outsideRoot, join(repositoryRoot, '.compartment'), 'dir');
    process.chdir(repositoryRoot);
    await writeCliConfig({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://default.example.com',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
        },
      },
    });

    const result: CliCommandResult = await runCliCommand(['remote', 'use', 'lab']);

    expectCliFailure(result, 'must not include symlinks');
    await expect(readFile(join(outsideRoot, 'state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails without partially writing project state when .gitignore is a symlink', async (): Promise<void> => {
    const workspaceRoot: string = await createTempDirectory('compartment-cli-remote-command-');
    const repositoryRoot: string = join(workspaceRoot, 'repo');
    const outsideRoot: string = join(workspaceRoot, 'outside');
    const outsideGitIgnorePath: string = join(outsideRoot, '.gitignore');

    await mkdir(repositoryRoot);
    await mkdir(outsideRoot);
    await writeFile(join(repositoryRoot, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await writeFile(join(repositoryRoot, 'compartment.yml'), 'name: smoke\nservices:\n  web: .\n', 'utf8');
    await writeFile(outsideGitIgnorePath, 'outside\n', 'utf8');
    await symlink(outsideGitIgnorePath, join(repositoryRoot, '.gitignore'));
    process.chdir(repositoryRoot);
    await writeCliConfig({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://default.example.com',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
        },
      },
    });

    const result: CliCommandResult = await runCliCommand(['remote', 'use', 'lab']);

    expectCliFailure(result, 'must not include symlinks');
    await expect(readFile(join(repositoryRoot, '.compartment', 'state.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(outsideGitIgnorePath, 'utf8')).resolves.toBe('outside\n');
  });

  it('removes a remote through the CLI JSON contract', async (): Promise<void> => {
    await writeCliConfig({
      currentRemote: 'lab',
      remotes: {
        eu: {
          apiUrl: 'https://eu.example.com',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
        },
      },
    });

    const result: CliJsonResult<CliRemoteRemoveResponse> = await runCliJson(
      ['remote', 'remove', 'lab', '--output', 'json'],
      cliRemoteRemoveResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload).toEqual({ remoteName: 'lab' });
    await expect(readCliConfig()).resolves.toEqual({
      remotes: {
        eu: {
          apiUrl: 'https://eu.example.com',
        },
      },
    });
  });
});

async function createProjectDirectory(): Promise<string> {
  const cwd: string = await createTempDirectory('compartment-cli-remote-command-');
  await writeFile(join(cwd, 'compartment.yml'), 'name: smoke\nservices:\n  web: .\n', 'utf8');

  return cwd;
}

async function createTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}
