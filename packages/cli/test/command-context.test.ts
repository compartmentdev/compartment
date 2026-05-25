import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAuthenticatedContext,
  resolveLoginApiUrl,
  resolveLoginRemoteName,
} from '../src/commands/command-context';
import { createCliConfigFixture } from './cli-test.fixtures';

const createdDirectories: string[] = [];

describe('command context helpers', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      createdDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('prefers the explicit login remote name', (): void => {
    expect(resolveLoginRemoteName(createCliConfigFixture(), 'lab')).toBe('lab');
  });

  it('falls back to the current remote name for login', (): void => {
    expect(resolveLoginRemoteName(createCliConfigFixture({ currentRemote: 'eu' }))).toBe('eu');
  });

  it('uses the default remote name when no current remote is selected', (): void => {
    expect(resolveLoginRemoteName({})).toBe('default');
  });

  it('prefers the explicit API URL over the stored remote API URL', (): void => {
    expect(resolveLoginApiUrl(createCliConfigFixture(), 'default', 'https://explicit.example.com')).toBe(
      'https://explicit.example.com',
    );
  });

  it('uses the stored remote API URL when no explicit API URL is provided', (): void => {
    expect(resolveLoginApiUrl(createCliConfigFixture({ apiUrl: 'https://stored.example.com' }), 'default')).toBe(
      'https://stored.example.com',
    );
  });

  it('throws when no API URL can be resolved for the selected remote', (): void => {
    expect((): void => {
      resolveLoginApiUrl({}, 'lab');
    }).toThrow('API URL is required. Run `compartment login --remote lab --api-url <url>` first.');
  });

  it('throws the first-login guidance when no remote is configured', async (): Promise<void> => {
    await expect(
      createAuthenticatedContext(
        {},
        {
          cwd: process.cwd(),
        },
      ),
    ).rejects.toThrow('No Compartment login is configured. Run `compartment login --api-url <url>` first.');
  });

  it('creates an authenticated context for the explicit remote', async (): Promise<void> => {
    await expect(
      createAuthenticatedContext(
        createCliConfigFixture({
          currentRemote: 'lab',
          remotes: {
            lab: {
              apiUrl: 'https://lab.example.com',
              sessionToken: 'lab-session',
            },
          },
        }),
        {
          cwd: process.cwd(),
          remoteName: 'lab',
        },
      ),
    ).resolves.toEqual({
      apiUrl: 'https://lab.example.com',
      currentOrganization: undefined,
      remoteName: 'lab',
      sessionToken: 'lab-session',
    });
  });

  it('includes a stored first-deploy onboarding session in the authenticated context', async (): Promise<void> => {
    await expect(
      createAuthenticatedContext(
        createCliConfigFixture({
          firstDeployOnboardingSessionId: 'fdo_123',
        }),
        {
          cwd: process.cwd(),
        },
      ),
    ).resolves.toEqual({
      apiUrl: 'https://console.example',
      currentOrganization: {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
      firstDeployOnboardingSessionId: 'fdo_123',
      remoteName: 'default',
      sessionToken: 'session_123',
    });
  });

  it('throws the logged-out guidance without requiring --api-url again', async (): Promise<void> => {
    await expect(
      createAuthenticatedContext(
        createCliConfigFixture({
          sessionToken: undefined,
        }),
        {
          cwd: process.cwd(),
        },
      ),
    ).rejects.toThrow('You are not logged in for remote "default". Run `compartment login --remote default` first.');
  });

  it('prefers the selected remote over the current remote', async (): Promise<void> => {
    const cwd: string = await createTempDirectory('compartment-cli-command-context-');
    await mkdir(join(cwd, '.compartment'), { recursive: true });
    await writeFile(join(cwd, 'compartment.yml'), 'name: web\nservices:\n  web: .\n', 'utf8');
    await writeFile(
      join(cwd, '.compartment', 'state.json'),
      `${JSON.stringify({ selectedRemote: 'lab' }, null, 2)}\n`,
      'utf8',
    );

    await expect(
      createAuthenticatedContext(
        {
          currentRemote: 'default',
          remotes: {
            default: {
              apiUrl: 'https://default.example.com',
              sessionToken: 'default-session',
            },
            lab: {
              apiUrl: 'https://lab.example.com',
              sessionToken: 'lab-session',
            },
          },
        },
        {
          cwd,
        },
      ),
    ).resolves.toEqual({
      apiUrl: 'https://lab.example.com',
      currentOrganization: undefined,
      remoteName: 'lab',
      sessionToken: 'lab-session',
    });
  });

  it('uses a Git-root binding when no nearer project binding exists', async (): Promise<void> => {
    const cwd: string = await createTempDirectory('compartment-cli-command-context-');
    await mkdir(join(cwd, '.compartment'), { recursive: true });
    await mkdir(join(cwd, 'apps', 'web', 'src'), { recursive: true });
    await writeFile(join(cwd, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await writeFile(join(cwd, '.compartment', 'state.json'), `${JSON.stringify({ selectedRemote: 'eu' }, null, 2)}\n`);
    await writeFile(join(cwd, 'apps', 'web', 'compartment.yml'), 'name: web\nservices:\n  web: .\n', 'utf8');

    await expect(
      createAuthenticatedContext(
        {
          currentRemote: 'default',
          remotes: {
            default: {
              apiUrl: 'https://default.example.com',
              sessionToken: 'default-session',
            },
            eu: {
              apiUrl: 'https://eu.example.com',
              sessionToken: 'eu-session',
            },
          },
        },
        {
          cwd: join(cwd, 'apps', 'web', 'src'),
        },
      ),
    ).resolves.toEqual({
      apiUrl: 'https://eu.example.com',
      currentOrganization: undefined,
      remoteName: 'eu',
      sessionToken: 'eu-session',
    });
  });

  it('prefers a nearer project binding over the Git-root binding', async (): Promise<void> => {
    const cwd: string = await createTempDirectory('compartment-cli-command-context-');
    const projectRoot: string = join(cwd, 'apps', 'web');
    await mkdir(join(cwd, '.compartment'), { recursive: true });
    await mkdir(join(projectRoot, '.compartment'), { recursive: true });
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(cwd, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
    await writeFile(join(cwd, '.compartment', 'state.json'), `${JSON.stringify({ selectedRemote: 'eu' }, null, 2)}\n`);
    await writeFile(
      join(projectRoot, '.compartment', 'state.json'),
      `${JSON.stringify({ selectedRemote: 'lab' }, null, 2)}\n`,
    );
    await writeFile(join(projectRoot, 'compartment.yml'), 'name: web\nservices:\n  web: .\n', 'utf8');

    await expect(
      createAuthenticatedContext(
        {
          currentRemote: 'default',
          remotes: {
            default: {
              apiUrl: 'https://default.example.com',
              sessionToken: 'default-session',
            },
            eu: {
              apiUrl: 'https://eu.example.com',
              sessionToken: 'eu-session',
            },
            lab: {
              apiUrl: 'https://lab.example.com',
              sessionToken: 'lab-session',
            },
          },
        },
        {
          cwd: join(projectRoot, 'src'),
        },
      ),
    ).resolves.toEqual({
      apiUrl: 'https://lab.example.com',
      currentOrganization: undefined,
      remoteName: 'lab',
      sessionToken: 'lab-session',
    });
  });

  it('throws remote selection guidance when no remote is selected', async (): Promise<void> => {
    await expect(
      createAuthenticatedContext(
        {
          remotes: {
            lab: {
              apiUrl: 'https://lab.example.com',
              sessionToken: 'lab-session',
            },
          },
        },
        {
          cwd: process.cwd(),
        },
      ),
    ).rejects.toThrow('No remote is selected. Pass --remote <name> or run `compartment remote use <name>` first.');
  });

  it('throws the configured-remote login guidance for missing remotes', async (): Promise<void> => {
    await expect(
      createAuthenticatedContext(
        {
          currentRemote: 'missing',
        },
        {
          cwd: process.cwd(),
        },
      ),
    ).rejects.toThrow(
      'Remote "missing" is not configured. Run `compartment login --remote missing --api-url <url>` first.',
    );
  });
});

async function createTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}
