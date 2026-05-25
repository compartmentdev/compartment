import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import type { CompartmentRequester } from '../src/http/request.types';
import { exchangeAppAccess } from '../src/services/app-access-exchange.service';
import { createJsonResponse, mockFetchSequence } from './fetch-test-helpers';

describe('app-access exchange service', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('rejects absolute redirect paths returned by the API', async (): Promise<void> => {
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example',
      internalToken: 'edge-token',
    });
    mockFetchSequence([
      createJsonResponse({
        appSessionToken: 'app-session-token',
        redirectPath: 'https://evil.example/phish',
        session: {
          authSessionId: 'ses_123',
          expiresAt: '2099-04-21T11:00:00.000Z',
          host: 'billing.localhost',
          principalEmail: 'admin@example.com',
          principalId: 'prn_123',
          principalType: 'user',
        },
      }),
    ]);

    await expect(exchangeAppAccess(request, { code: 'abc', host: 'billing.localhost', state: 'flow' })).rejects.toThrow(
      'Compartment API returned an invalid response for /internal/app-access/exchange.',
    );
  });
});
