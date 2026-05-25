import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { persistDevInstallSession, persistInstallSession } from '../src/commands/install/install.command.session';
import type { SelfHostedInstallResult } from '../src/install.types';
import { readCliConfig, writeCliConfig } from '../src/store/config.store';

const createdDirectories: string[] = [];

describe.sequential('install command session persistence', (): void => {
  let previousConfigDirectory: string | undefined;

  beforeEach(async (): Promise<void> => {
    previousConfigDirectory = process.env.COMPARTMENT_CLI_CONFIG_DIR;
    process.env.COMPARTMENT_CLI_CONFIG_DIR = await createTempDirectory('compartment-install-session-');
  });

  afterEach(async (): Promise<void> => {
    if (previousConfigDirectory === undefined) {
      delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    } else {
      process.env.COMPARTMENT_CLI_CONFIG_DIR = previousConfigDirectory;
    }
    await Promise.all(
      createdDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('stores dev installs under local-dev by default and preserves existing remotes', async (): Promise<void> => {
    await writeCliConfig({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://default.example.com',
          sessionToken: 'default-session',
        },
      },
    });

    await persistDevInstallSession(createInstallResult());

    await expect(readCliConfig()).resolves.toEqual({
      currentRemote: 'local-dev',
      remotes: {
        default: {
          apiUrl: 'https://default.example.com',
          sessionToken: 'default-session',
        },
        'local-dev': {
          apiUrl: 'http://127.0.0.1:9443',
          currentOrganization: {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
          principalEmail: 'admin@example.com',
          sessionToken: 'session_123',
        },
      },
    });
  });

  it('stores dev installs under the requested remote name', async (): Promise<void> => {
    await persistDevInstallSession(createInstallResult(), 'lab-dev');

    await expect(readCliConfig()).resolves.toEqual({
      currentRemote: 'lab-dev',
      remotes: {
        'lab-dev': {
          apiUrl: 'http://127.0.0.1:9443',
          currentOrganization: {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
          principalEmail: 'admin@example.com',
          sessionToken: 'session_123',
        },
      },
    });
  });

  it('stores packaged installs under default and preserves existing remotes', async (): Promise<void> => {
    await writeCliConfig({
      currentRemote: 'staging',
      remotes: {
        staging: {
          apiUrl: 'https://staging.example.com',
          currentOrganization: {
            id: 'org_staging',
            name: 'Staging',
            slug: 'staging',
          },
          principalEmail: 'staging@example.com',
          sessionToken: 'staging-session',
        },
      },
    });

    await persistInstallSession(createInstallResult());

    await expect(readCliConfig()).resolves.toEqual({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'http://127.0.0.1:9443',
          currentOrganization: {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
          principalEmail: 'admin@example.com',
          sessionToken: 'session_123',
        },
        staging: {
          apiUrl: 'https://staging.example.com',
          currentOrganization: {
            id: 'org_staging',
            name: 'Staging',
            slug: 'staging',
          },
          principalEmail: 'staging@example.com',
          sessionToken: 'staging-session',
        },
      },
    });
  });
});

function createInstallResult(): SelfHostedInstallResult {
  return {
    adminEmail: 'admin@example.com',
    apiUrl: 'http://127.0.0.1:9443',
    baseDomain: '127.0.0.1.sslip.io',
    compartmentUrl: 'https://console.example.com',
    configDir: '/tmp/config',
    dataDir: '/tmp/data',
    dnsRecords: [
      {
        host: 'console.example.com',
        purpose: 'Console',
        type: 'A/AAAA-or-CNAME',
      },
    ],
    operation: {
      completedAt: '2026-03-30T10:00:05.000Z',
      createdAt: '2026-03-30T10:00:00.000Z',
      id: 'op_123',
      status: 'succeeded',
      targetId: 'env_123',
      targetType: 'environment',
      type: 'install.run',
    },
    organization: {
      id: 'org_123',
      name: 'Acme Dev',
      slug: 'acme-dev',
    },
    sessionToken: 'session_123',
  };
}

async function createTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}
