import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireManagedBrokerUrl } from '../src/services/kubernetes-install-managed-state.support';
import { reserveInstallManagedDomain } from '../src/services/managed-domain.service';

describe('managed-domain broker configuration', (): void => {
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

  it('reports the absolute broker URL for a non-HTTP reservation failure', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(Response.json({}))),
    );

    await expect(
      reserveInstallManagedDomain({
        brokerUrl: 'https://broker.compartment.run',
        installationId: 'installation-123',
        requestedLabelSource: 'Acme',
      }),
    ).rejects.toThrow(
      'Managed-domain broker POST https://broker.compartment.run/v1/managed-domains/allocations request failed while attempting to reserve managed domain:',
    );
  });

  it('rejects broker URLs containing credentials without echoing them', async (): Promise<void> => {
    const brokerUrl: string = 'https://broker-user:broker-secret@broker.compartment.run';

    await expect(
      reserveInstallManagedDomain({
        brokerUrl,
        installationId: 'installation-123',
        requestedLabelSource: 'Acme',
      }),
    ).rejects.toSatisfy(
      (error: Error): boolean => !error.message.includes('broker-user') && !error.message.includes('broker-secret'),
    );
  });
});
