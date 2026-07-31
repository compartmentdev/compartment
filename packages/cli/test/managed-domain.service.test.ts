import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireManagedBrokerUrl } from '../src/services/kubernetes-install-managed-state.support';
import { allocateInstallManagedDomain } from '../src/services/managed-domain.service';

describe('managed-domain broker configuration', (): void => {
  const publicIp: string = [8, 8, 8, 8].join('.');
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('rejects empty retained broker URLs with actionable configuration guidance', (): void => {
    for (const brokerUrl of ['', '   ']) {
      expect((): string => requireManagedBrokerUrl(brokerUrl)).toThrow(
        'Set --broker-url or COMPARTMENT_MANAGED_DOMAIN_BROKER_URL; the default https://broker.compartment.run should otherwise be applied.',
      );
    }
  });

  it('reports the absolute broker URL for a non-HTTP allocation failure', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(Response.json({}))),
    );

    await expect(
      allocateInstallManagedDomain({
        brokerUrl: 'https://broker.compartment.run',
        installationId: 'installation-123',
        publicIp,
        requestedLabelSource: 'Acme',
      }),
    ).rejects.toThrow(
      'Managed-domain broker POST https://broker.compartment.run/v1/managed-domains request failed while attempting to allocate managed domain:',
    );
  });

  it('rejects broker URLs containing credentials without echoing them', async (): Promise<void> => {
    const brokerUrl: string = 'https://broker-user:broker-secret@broker.compartment.run';

    await expect(
      allocateInstallManagedDomain({
        brokerUrl,
        installationId: 'installation-123',
        publicIp,
        requestedLabelSource: 'Acme',
      }),
    ).rejects.toSatisfy(
      (error: Error): boolean => !error.message.includes('broker-user') && !error.message.includes('broker-secret'),
    );
  });
});
