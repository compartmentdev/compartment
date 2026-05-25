import type { DeploymentLogsResponse } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import type { CompartmentRequester } from '../src/http/request.types';
import { getDeploymentLogs } from '../src/services/deployment-logs.service';
import { createJsonResponse, mockFetchSequence, readRequestUrl } from './fetch-test-helpers';
import type { FetchCall, FetchMockState } from './fetch-test.types';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('deployment logs service', (): void => {
  it('omits optional query params when they are not provided', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createDeploymentLogsResponse())]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      currentOrganization: 'acme-dev',
      sessionToken: 'session_123',
    });

    await getDeploymentLogs(request, {
      environmentName: 'production',
      projectName: 'smoke-web',
    });

    expect(fetchState.calls.map((call: FetchCall): string => readRequestUrl(call))).toEqual([
      'https://console.example/v1/deployments/logs?projectName=smoke-web&environmentName=production',
    ]);
  });

  it('includes provided optional query params in the request path', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createDeploymentLogsResponse())]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      currentOrganization: 'acme-dev',
      sessionToken: 'session_123',
    });

    await getDeploymentLogs(request, {
      environmentName: 'production',
      projectName: 'smoke-web',
      serviceName: 'web',
      since: '2026-03-23T12:00:00.000Z',
      tailLines: 200,
    });

    expect(fetchState.calls.map((call: FetchCall): string => readRequestUrl(call))).toEqual([
      'https://console.example/v1/deployments/logs?projectName=smoke-web&environmentName=production&serviceName=web&since=2026-03-23T12%3A00%3A00.000Z&tailLines=200',
    ]);
  });
});

function createDeploymentLogsResponse(): DeploymentLogsResponse {
  return {
    deployments: [],
    environment: {
      name: 'production',
    },
    lines: [],
    project: {
      name: 'smoke-web',
    },
  };
}
