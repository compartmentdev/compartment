import { describe, expect, it } from 'vitest';
import { resolveInstallWizard } from '../src/commands/install/install.command.wizard';
import { createCliCapture, type CliCommandCapture } from './cli-test.harness';

describe('guided install values', (): void => {
  it('maps managed-domain answers to detected storage without overriding managed platform state', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('\n\n');

    await expect(resolveInstallWizard(capture.io, 'local-path')).resolves.toMatchObject({
      answers: { domainMode: 'managed', storageClass: 'local-path' },
      values: { storage: { storageClass: 'local-path' } },
    });
  });

  it('maps custom-http answers to the existing external TLS mode', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('2\napps.example.com\n1\nfast-storage\n');

    await expect(resolveInstallWizard(capture.io, '')).resolves.toMatchObject({
      answers: { baseDomain: 'apps.example.com', domainMode: 'custom', tlsMode: 'custom-http' },
      values: { platform: { tlsMode: 'custom-http' }, storage: { storageClass: 'fast-storage' } },
    });
  });

  it('maps custom-cert answers to an existing TLS Secret', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('2\napps.example.com\n2\na..b\ncompartment-public-tls\nfast-storage\n');

    await expect(resolveInstallWizard(capture.io, '')).resolves.toMatchObject({
      answers: { customTlsSecret: 'compartment-public-tls', tlsMode: 'custom-cert' },
      values: {
        customTls: { existingSecret: 'compartment-public-tls' },
        platform: { tlsMode: 'custom-cert' },
        storage: { storageClass: 'fast-storage' },
      },
    });
    expect(capture.stderr.join('')).toContain('Enter the name of an existing Kubernetes TLS Secret');
  });
});
