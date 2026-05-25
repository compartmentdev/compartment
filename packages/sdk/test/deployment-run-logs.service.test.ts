import type { DeploymentRunLogsResponse } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import type { CompartmentRequester } from '../src/http/request.types';
import { getDeploymentRunLogs } from '../src/services/deployment-run-logs.service';
import { createJsonResponse, mockFetchSequence, readRequestUrl } from './fetch-test-helpers';
import type { FetchCall, FetchMockState } from './fetch-test.types';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('deployment run logs service', (): void => {
  it('includes the latest selector when requesting latest run logs', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createDeploymentRunLogsResponse())]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      currentOrganization: 'acme-dev',
      sessionToken: 'session_123',
    });

    await getDeploymentRunLogs(request, {
      environmentName: 'production',
      projectName: 'smoke-web',
      selector: 'latest',
    });

    expect(fetchState.calls.map((call: FetchCall): string => readRequestUrl(call))).toEqual([
      'https://console.example/v1/deployments/runs/logs?projectName=smoke-web&selector=latest&environmentName=production',
    ]);
  });

  it('includes deployment and line filters in the request path', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createDeploymentRunLogsResponse())]);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://console.example/',
      currentOrganization: 'acme-dev',
      sessionToken: 'session_123',
    });

    await getDeploymentRunLogs(request, {
      deploymentRunId: 'drn_123',
      environmentName: 'production',
      projectName: 'smoke-web',
      selector: 'run',
      serviceName: 'web',
      since: '2026-03-23T12:00:00.000Z',
      tailLines: 200,
    });

    expect(fetchState.calls.map((call: FetchCall): string => readRequestUrl(call))).toEqual([
      'https://console.example/v1/deployments/runs/logs?projectName=smoke-web&selector=run&deploymentRunId=drn_123&environmentName=production&serviceName=web&since=2026-03-23T12%3A00%3A00.000Z&tailLines=200',
    ]);
  });
});

function createDeploymentRunLogsResponse(): DeploymentRunLogsResponse {
  return {
    deployment: {
      completedAt: null,
      createdAt: '2026-03-23T12:00:00.000Z',
      failureMessage: null,
      id: 'drn_123',
      label: null,
      status: 'running',
      trigger: {
        branchName: null,
        commitSha: null,
        repositoryName: null,
        repositoryOwner: null,
        sourceEventId: null,
        sourceResolutionTaskId: null,
        type: 'manual',
      },
    },
    deployments: [],
    environment: {
      name: 'production',
    },
    lines: [],
    project: {
      name: 'smoke-web',
    },
    steps: [],
  };
}
