import type { SelfHostedInstallResult } from '../src/install.types';

export function createInstallCommandResultFixture(): SelfHostedInstallResult {
  return {
    adminEmail: 'admin@example.com',
    apiUrl: 'http://127.0.0.1:9443',
    baseDomain: 'localhost',
    compartmentUrl: 'http://console.localhost:9443',
    configDir: '/tmp/compartment-install/etc',
    dataDir: '/tmp/compartment-install/var',
    dnsRecords: [
      {
        host: '*.localhost',
        purpose: 'Apps',
        type: 'A/AAAA-or-CNAME',
      },
    ],
    operation: {
      completedAt: '2026-04-01T00:00:00.000Z',
      createdAt: '2026-04-01T00:00:00.000Z',
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
