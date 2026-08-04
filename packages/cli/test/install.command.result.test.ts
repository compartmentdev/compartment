import { describe, expect, it } from 'vitest';
import { renderInstallResult } from '../src/commands/install/install.command.result';
import type { CliInstallResult } from '../src/install.types';
import { createCliCapture, type CliCommandCapture } from './cli-test.harness';

describe('install result output', (): void => {
  it('renders the continue setup heading in bold on a terminal', (): void => {
    const originalNoColor: string | undefined = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    const capture: CliCommandCapture = createCliCapture({ stdoutIsTTY: true });

    try {
      renderInstallResult(capture.io, 'text', createInstallResult(), false);
    } finally {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }

    expect(capture.stdout.join('')).toContain('\u001B[1mContinue setup:\u001B[22m');
  });
});

function createInstallResult(): CliInstallResult {
  return {
    adminEmail: 'admin@example.com',
    apiUrl: 'https://console.apps.example.com',
    baseDomain: 'apps.example.com',
    compartmentUrl: 'https://console.apps.example.com',
    dnsRecords: [],
    operation: {
      completedAt: '2026-08-04T16:00:05.000Z',
      createdAt: '2026-08-04T16:00:00.000Z',
      id: 'op_123',
      status: 'succeeded',
      targetId: 'org_123',
      targetType: 'organization',
      type: 'compartment.install',
    },
    organization: { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
    sessionToken: 'session_123',
  };
}
