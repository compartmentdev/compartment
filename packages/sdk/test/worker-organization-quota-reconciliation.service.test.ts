import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import type { CompartmentRequester } from '../src/http/request.types';
import {
  claimOrganizationQuotaReconcile,
  completeOrganizationQuotaReconcile,
} from '../src/services/worker-organization-quota-reconciliation.service';
import { createJsonResponse, mockFetchSequence, readRequestUrl } from './fetch-test-helpers';
import type { FetchCall, FetchMockState } from './fetch-test.types';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('worker organization quota reconciliation service', (): void => {
  it('uses the private claim and lease-fenced completion paths', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([
      createJsonResponse({ target: { leaseId: 'oql_1', organizationId: 'org_1' } }),
      createJsonResponse({ applied: true }),
    ]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      internalToken: 'worker-token',
    });
    await claimOrganizationQuotaReconcile(request);
    await completeOrganizationQuotaReconcile(request, {
      leaseId: 'oql_1',
      organizationId: 'org_1',
      status: 'succeeded',
    });
    expect(fetchState.calls.map((call: FetchCall): string => readRequestUrl(call))).toEqual([
      'https://console.example/internal/organization-quotas/claim-next',
      'https://console.example/internal/organization-quotas/complete',
    ]);
  });
});
