import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import type { CompartmentRequester } from '../src/http/request.types';
import {
  claimProjectProvisioning,
  completeProjectProvisioning,
} from '../src/services/worker-project-provisioning.service';
import { createJsonResponse, mockFetchSequence, readRequestUrl } from './fetch-test-helpers';
import type { FetchCall, FetchMockState } from './fetch-test.types';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('worker project provisioning service', (): void => {
  it('uses the internal claim and completion contracts', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([
      createJsonResponse({ target: null }),
      createJsonResponse({ applied: true }),
    ]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      internalToken: 'worker-token',
    });

    await claimProjectProvisioning(request);
    await completeProjectProvisioning(request, {
      generation: 1,
      leaseId: 'kpl_1',
      projectId: 'prj_1',
      status: 'succeeded',
    });

    expect(fetchState.calls.map((call: FetchCall): string => readRequestUrl(call))).toEqual([
      'https://console.example/internal/kube-projects/claim-next',
      'https://console.example/internal/kube-projects/complete',
    ]);
  });
});
