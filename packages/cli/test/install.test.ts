import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { installKubernetesOwner } from '../src/install';
import type { InstallInput } from '../src/services/install.service.types';

const ownerInput: InstallInput = {
  adminEmail: 'admin@example.com',
  adminPassword: 'supersecretpassword',
  baseDomain: 'apps.example.com',
  organizationName: 'Acme Dev',
};

describe('Kubernetes owner install', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('does not retry an ambiguous 5xx and explains how to resume safely', async (): Promise<void> => {
    const ownerFetch: Mock<() => Promise<Response>> = vi.fn(
      async (): Promise<Response> =>
        await Promise.resolve(new Response('', { headers: { 'x-request-id': 'req_owner_123' }, status: 502 })),
    );
    vi.stubGlobal('fetch', ownerFetch);

    await expect(
      installKubernetesOwner('https://console.apps.example.com', 'install-token', ownerInput),
    ).rejects.toThrow(
      'Creating owner: POST https://console.apps.example.com/v1/install failed with status 502 (request-id: req_owner_123). This request was not retried because owner creation may already have completed. Try logging in; if no owner exists, re-run install to resume.',
    );
    expect(ownerFetch).toHaveBeenCalledTimes(1);
  });
});
