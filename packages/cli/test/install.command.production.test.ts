import type { InstallResponse } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliInstallResult } from '../src/install.types';
import {
  createCliCapture,
  expectCliSuccess,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  type CliCommandResult,
} from './cli-test.harness';

const mockedModulePaths: readonly string[] = [
  '../src/commands/install/install.command.identity',
  '../src/commands/install/install.command.session',
  '../src/install',
  '../src/services/kubernetes-install.service',
];

describe.sequential('production install command', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules(mockedModulePaths);
  });

  it('collects owner credentials before exposing the one-time install endpoint', async (): Promise<void> => {
    const events: string[] = [];
    mockProductionInstallModules(events);

    const result: CliCommandResult = await runCliCommand(
      [
        'install',
        '--api-url',
        'https://console.apps.example.com',
        '--base-domain',
        'apps.example.com',
        '--values',
        'compartment-values.yaml',
        '--output',
        'json',
      ],
      createCliCapture(),
    );

    expectCliSuccess(result);
    expect(events).toEqual(['prompt', 'deploy', 'bootstrap:install-token', 'persist']);
  });
});

function mockProductionInstallModules(events: string[]): void {
  vi.doMock('../src/commands/install/install.command.identity', (): object => ({
    resolveInstallIdentityPrompts: (): object => {
      events.push('prompt');
      return {
        adminEmail: 'admin@example.com',
        adminPassword: 'correct horse battery staple',
        organizationName: 'Acme Dev',
      };
    },
  }));
  vi.doMock('../src/services/kubernetes-install.service', (): object => ({
    deployAndWaitForKubernetesInstall: (): object => {
      events.push('deploy');
      return { installToken: 'install-token' };
    },
  }));
  vi.doMock('../src/install', (): object => ({
    installDev: vi.fn(),
    installKubernetesOwner: (_apiUrl: string, installToken: string): CliInstallResult => {
      events.push(`bootstrap:${installToken}`);
      return createInstallResult();
    },
  }));
  vi.doMock('../src/commands/install/install.command.session', (): object => ({
    persistDevInstallSession: vi.fn(),
    persistInstallSession: (): void => {
      events.push('persist');
    },
  }));
}

function createInstallResult(): CliInstallResult {
  const response: InstallResponse = {
    adminEmail: 'admin@example.com',
    baseDomain: 'apps.example.com',
    compartmentUrl: 'https://console.apps.example.com',
    dnsRecords: [
      {
        host: '*.apps.example.com',
        purpose: 'Compartment control plane and hosted application entrypoints',
        type: 'A/AAAA-or-CNAME',
      },
    ],
    operation: {
      completedAt: '2026-07-16T12:00:01.000Z',
      createdAt: '2026-07-16T12:00:00.000Z',
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

  return { ...response, apiUrl: response.compartmentUrl };
}
