import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerPersistProductJobResultRequest } from '@compartment/contracts';
import { createCompartmentRequester } from '../src/http/request';
import type { CompartmentRequester } from '../src/http/request.types';
import { claimProductJob, persistProductJobIntent } from '../src/services/worker-product-job.service';
import { createJsonResponse, mockFetchSequence, readRequestUrl } from './fetch-test-helpers';
import type { FetchCall, FetchMockState } from './fetch-test.types';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('worker product Job service', (): void => {
  it('returns durable cancellation evidence from intent persistence', async (): Promise<void> => {
    const result: WorkerPersistProductJobResultRequest = {
      completedAt: '2026-07-12T12:00:00.000Z',
      exitCode: null,
      identityId: 'dep_1',
      jobClass: 'release',
      jobName: 'archived-job/dep_1',
      logs: 'project archived',
      podName: null,
      status: 'timed-out',
    };
    mockFetchSequence([createJsonResponse({ result })]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      internalToken: 'worker-token',
    });

    await expect(
      persistProductJobIntent(request, {
        command: ['bin/release'],
        deploymentId: 'dep_1',
        env: {},
        image: 'registry.example/release@sha256:abc',
        imagePullSecretId: 'pull-project',
        jobClass: 'release',
        namespace: 'cpt-prj-1',
        projectId: 'prj_1',
        timeoutMs: 30_000,
      }),
    ).resolves.toEqual({ result });
  });

  it('scopes claims to one execution lane', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([
      createJsonResponse({ job: null, resourceReadiness: [], result: null }),
    ]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      internalToken: 'worker-token',
    });

    await claimProductJob(request, { jobClass: 'resource-operation' });

    expect(readRequestUrl(fetchState.calls[0]!)).toBe('https://console.example/internal/kube-jobs/claim-next');
    expect(JSON.parse(requireRequestBody(fetchState.calls[0]!))).toEqual({ jobClass: 'resource-operation' });
  });
});

function requireRequestBody(call: FetchCall): string {
  if (typeof call.init?.body !== 'string') {
    throw new Error('Expected a JSON request body.');
  }
  return call.init.body;
}
