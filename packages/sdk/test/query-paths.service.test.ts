import {
  buildCompartmentVariableGroupPathname,
  buildCompartmentVariableGroupUsagesPathname,
  type DeploymentInspectResponse,
  type DeploymentStatusResponse,
  type ListCustomDomainsResponse,
  type ProjectStatusListResponse,
  type UserListResponse,
  type WhoAmIResponse,
} from '@compartment/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import type { CompartmentBinaryRequester, CompartmentRequester } from '../src/http/request.types';
import { exportAuditEvents, listAuditEvents } from '../src/services/audit-events.service';
import { listAccessGroups } from '../src/services/access-group.service';
import { listAccessRoles } from '../src/services/access-role.service';
import { listCustomDomains } from '../src/services/custom-domain.service';
import { getDeploymentInspect } from '../src/services/deployment-inspect.service';
import { getDeploymentStatus } from '../src/services/deployment-status.service';
import { listProjects } from '../src/services/project-list.service';
import { listUsers } from '../src/services/users-list.service';
import {
  buildVariableBindingItemPath,
  buildVariableCollectionPath,
  buildVariableGroupCapturePath,
  buildVariableGroupCollectionPath,
  buildVariableGroupImportPath,
  buildVariableGroupVariableCollectionPath,
  buildVariableItemPath,
} from '../src/services/variable-path.service';
import { getWhoAmI } from '../src/services/whoami.service';
import { createJsonResponse, mockFetchSequence, readRequestUrl } from './fetch-test-helpers';
import type { FetchCall, FetchMockState } from './fetch-test.types';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('sdk query path services', (): void => {
  it('builds whoami paths with an optional project environment scope', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([
      createJsonResponse(createWhoAmIResponse()),
      createJsonResponse(createWhoAmIResponse()),
    ]);

    await getWhoAmI(createRequest());
    await getWhoAmI(createRequest(), {
      environmentName: 'production',
      projectName: 'smoke-web',
    });

    expect(readUrls(fetchState)).toEqual([
      'https://console.example/v1/whoami',
      'https://console.example/v1/whoami?projectName=smoke-web&environmentName=production',
    ]);
  });

  it('preserves deployment status query parameter order', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createDeploymentStatusResponse())]);

    await getDeploymentStatus(createRequest(), {
      deploymentId: 'dep_123',
      environmentName: 'production',
      projectName: 'smoke-web',
      serviceName: 'web',
    });

    expect(readUrls(fetchState)).toEqual([
      'https://console.example/v1/deployments/status?projectName=smoke-web&environmentName=production&deploymentId=dep_123&serviceName=web',
    ]);
  });

  it('preserves deployment inspect query parameter order', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createDeploymentInspectResponse())]);

    await getDeploymentInspect(createRequest(), {
      deploymentId: 'dep_123',
      environmentName: 'production',
      projectName: 'smoke-web',
      serviceName: 'web',
    });

    expect(readUrls(fetchState)).toEqual([
      'https://console.example/v1/deployments/inspect?projectName=smoke-web&environmentName=production&deploymentId=dep_123&serviceName=web',
    ]);
  });

  it('preserves custom domain list query parameter order and omits empty params', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([
      createJsonResponse(createCustomDomainListResponse()),
      createJsonResponse(createCustomDomainListResponse()),
    ]);

    await listCustomDomains(createRequest(), {
      environmentName: 'production',
      projectName: 'smoke-web',
      serviceName: 'web',
    });
    await listCustomDomains(createRequest());

    expect(readUrls(fetchState)).toEqual([
      'https://console.example/v1/domains?environmentName=production&projectName=smoke-web&serviceName=web',
      'https://console.example/v1/domains',
    ]);
  });

  it('serializes repeated projectIds for status detail queries', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createProjectStatusListResponse())]);

    await listProjects(createRequest(), {
      detail: 'status',
      projectIds: ['prj_123', 'prj_456'],
    });

    expect(readUrls(fetchState)).toEqual([
      'https://console.example/v1/projects?detail=status&projectIds=prj_123&projectIds=prj_456',
    ]);
  });

  it('builds roles, groups, and audit query paths for the new list contracts', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([
      createJsonResponse({ detail: 'options', roles: [] }),
      createJsonResponse({ detail: 'options', groups: [] }),
      createJsonResponse({ events: [], pagination: { page: 1, perPage: 25, totalItems: 0, totalPages: 1 } }),
      createJsonResponse(new Uint8Array()),
    ]);

    await listAccessRoles(createRequest());
    await listAccessGroups(createRequest());
    await listAuditEvents(createRequest(), {
      actor: 'admin@example.com',
      orderBy: 'status',
      page: 1,
      perPage: 25,
      sort: 'asc',
    });
    await exportAuditEvents(createBinaryRequest(), {
      format: 'csv',
      orderBy: 'eventType',
      sort: 'desc',
    });

    expect(readUrls(fetchState)).toEqual([
      'https://console.example/v1/roles?detail=options',
      'https://console.example/v1/groups?detail=options',
      'https://console.example/v1/audit/events?actor=admin%40example.com&orderBy=status&page=1&perPage=25&sort=asc',
      'https://console.example/v1/audit/events/export?format=csv&orderBy=eventType&sort=desc',
    ]);
  });

  it('serializes the optional user type filter for user list queries', async (): Promise<void> => {
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createUserListResponse())]);

    await listUsers(createRequest(), {
      page: 2,
      perPage: 10,
      search: 'viewer',
      sort: 'desc',
      type: 'user',
    });

    expect(readUrls(fetchState)).toEqual([
      'https://console.example/v1/users?page=2&perPage=10&search=viewer&sort=desc&type=user',
    ]);
  });

  it('preserves variable target query parameter order', (): void => {
    expect(
      buildVariableCollectionPath({
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      }),
    ).toBe('/v1/variables?projectName=smoke-web&environmentName=production&serviceName=web');
    expect(
      buildVariableItemPath('API_KEY', {
        projectName: 'smoke-web',
      }),
    ).toBe('/v1/variables/API_KEY?projectName=smoke-web');
  });

  it('builds variable group and binding paths consistently', (): void => {
    expect(buildVariableGroupCollectionPath()).toBe('/v1/variable-groups');
    expect(buildVariableGroupCapturePath()).toBe('/v1/variable-groups/capture');
    expect(buildVariableGroupImportPath()).toBe('/v1/variable-groups/import');
    expect(buildVariableGroupVariableCollectionPath()).toBe('/v1/variable-groups/variables');
    expect(buildCompartmentVariableGroupPathname('postgres-prod')).toBe('/v1/variable-groups/postgres-prod');
    expect(buildCompartmentVariableGroupUsagesPathname('postgres-prod')).toBe(
      '/v1/variable-groups/postgres-prod/usages',
    );
    expect(
      buildVariableBindingItemPath({
        environmentName: 'production',
        projectName: 'billing',
        serviceName: 'api',
        variableGroupName: 'sentry-shared',
      }),
    ).toBe('/v1/variables/bindings/sentry-shared?projectName=billing&environmentName=production&serviceName=api');
  });
});

function createRequest(): CompartmentRequester {
  return createCompartmentRequester({
    apiUrl: 'https://console.example/',
    sessionToken: 'session_123',
  });
}

function createBinaryRequest(): CompartmentBinaryRequester {
  return async ({ path }: { path: string }): Promise<Buffer> => {
    await fetch(new URL(path, 'https://console.example/').toString(), {
      method: 'POST',
    });

    return Buffer.alloc(0);
  };
}

function createDeploymentStatusResponse(): DeploymentStatusResponse {
  return {
    activeDeployments: [],
    deployments: [],
    environment: {
      name: 'production',
    },
    project: {
      name: 'smoke-web',
    },
  };
}

function createDeploymentInspectResponse(): DeploymentInspectResponse {
  return {
    activeDeployments: [],
    deployments: [],
    environment: {
      createdAt: '2026-03-24T10:00:00.000Z',
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: '2026-03-24T10:00:00.000Z',
    },
    project: {
      archivedAt: null,
      createdAt: '2026-03-24T10:00:00.000Z',
      id: 'prj_123',
      name: 'smoke-web',
      organizationId: 'org_123',
      updatedAt: '2026-03-24T10:00:00.000Z',
    },
    sensitiveTopologyVisible: false,
  };
}

function createCustomDomainListResponse(): ListCustomDomainsResponse {
  return {
    domains: [],
  };
}

function createProjectStatusListResponse(): ProjectStatusListResponse {
  return {
    detail: 'status',
    projects: [],
  };
}

function createWhoAmIResponse(): WhoAmIResponse {
  return {
    currentOrganization: null,
    currentOrganizationPermissions: [],
    principal: {
      email: 'admin@example.com',
      id: 'prn_123',
      type: 'user',
    },
  };
}

function createUserListResponse(): UserListResponse {
  return {
    pagination: {
      page: 1,
      perPage: 10,
      totalItems: 0,
      totalPages: 1,
    },
    users: [],
  };
}

function readUrls(fetchState: FetchMockState): string[] {
  return fetchState.calls.map((call: FetchCall): string => readRequestUrl(call));
}
