import type { WorkerRecoverDeploymentsResponse } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import type { CompartmentRequester } from '../src/http/request.types';
import { recoverRunningDeployments } from '../src/services/worker-recover-deployments.service';
import { createJsonResponse, mockFetchSequence, readRequestUrl } from './fetch-test-helpers';
import type { FetchCall, FetchMockState } from './fetch-test.types';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('worker recover deployments service', (): void => {
  it('uses the default recovery path when no mode is provided', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createRecoverDeploymentsResponse())]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      sessionToken: 'session_123',
    });

    await recoverRunningDeployments(request);

    expect(fetchState.calls.map((call: FetchCall): string => readRequestUrl(call))).toEqual([
      'https://console.example/internal/deployments/recover-running',
    ]);
  });

  it('adds the recovery mode query when provided', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createRecoverDeploymentsResponse())]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      sessionToken: 'session_123',
    });

    await recoverRunningDeployments(request, {
      mode: 'pending-drain',
    });

    expect(fetchState.calls.map((call: FetchCall): string => readRequestUrl(call))).toEqual([
      'https://console.example/internal/deployments/recover-running?mode=pending-drain',
    ]);
  });
});

function createRecoverDeploymentsResponse(): WorkerRecoverDeploymentsResponse {
  return {
    cleanupArtifacts: [],
    recoveredDeploymentCount: 0,
  };
}
