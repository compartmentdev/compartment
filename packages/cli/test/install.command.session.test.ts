import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { persistInstallSession } from '../src/commands/install/install.command.session';
import type { CliInstallResult } from '../src/install.types';
import { readCliConfig, writeCliConfig } from '../src/store/config.store';

const createdDirectories: string[] = [];

describe.sequential('production install session persistence', (): void => {
  let previousConfigDirectory: string | undefined;

  beforeEach(async (): Promise<void> => {
    previousConfigDirectory = process.env.COMPARTMENT_CLI_CONFIG_DIR;
    process.env.COMPARTMENT_CLI_CONFIG_DIR = await createTempDirectory();
  });

  afterEach(async (): Promise<void> => {
    if (previousConfigDirectory === undefined) {
      delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    } else {
      process.env.COMPARTMENT_CLI_CONFIG_DIR = previousConfigDirectory;
    }
    await Promise.all(
      createdDirectories
        .splice(0)
        .map(async (directory: string): Promise<void> => await rm(directory, { force: true, recursive: true })),
    );
  });

  it('stores the owner session under default without removing existing remotes', async (): Promise<void> => {
    await writeCliConfig({
      currentRemote: 'staging',
      remotes: {
        staging: {
          apiUrl: 'https://console.staging.example.com',
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
          apiUrl: 'https://console.apps.example.com',
          currentOrganization: {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
          principalEmail: 'admin@example.com',
          sessionToken: 'session_123',
        },
        staging: {
          apiUrl: 'https://console.staging.example.com',
          principalEmail: 'staging@example.com',
          sessionToken: 'staging-session',
        },
      },
    });
  });
});

function createInstallResult(): CliInstallResult {
  return {
    adminEmail: 'admin@example.com',
    apiUrl: 'https://console.apps.example.com',
    baseDomain: 'apps.example.com',
    compartmentUrl: 'https://console.apps.example.com',
    dnsRecords: [
      {
        host: 'console.apps.example.com',
        purpose: 'Console',
        type: 'A/AAAA-or-CNAME',
      },
    ],
    operation: {
      completedAt: '2026-03-30T10:00:05.000Z',
      createdAt: '2026-03-30T10:00:00.000Z',
      id: 'op_123',
      status: 'succeeded',
      targetId: 'org_123',
      targetType: 'organization',
      type: 'compartment.install',
    },
    organization: {
      id: 'org_123',
      name: 'Acme Dev',
      slug: 'acme-dev',
    },
    sessionToken: 'session_123',
  };
}

async function createTempDirectory(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-install-session-'));
  createdDirectories.push(directory);
  return directory;
}
