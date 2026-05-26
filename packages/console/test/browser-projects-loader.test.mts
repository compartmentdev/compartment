import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { loadProjectsPageDataForUrl } from '../src/features/projects/projects-loader';
import type { BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';
import { createJsonResponse } from './browser-test.fixtures';
import {
  createOrganizationListResponse,
  createWhoamiResponse,
  readFetchPath,
  type BrowserFetchCall,
  type FetchImplementation,
} from './browser-client-pages.helpers';

const browserAllProjectCountPath: string =
  '/v1/projects?archiveState=all&detail=overview&orderBy=updatedAt&page=1&perPage=1&sort=desc';
const browserAllProjectsPath: string =
  '/v1/projects?detail=overview&archiveState=all&orderBy=updatedAt&sort=desc&page=1&perPage=10';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('browser projects loader', (): void => {
  it('leaves all project requests on the API-owned scoped surface', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createProjectsFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectsPageResult = await loadProjectsPageDataForUrl(
      new URL('http://console.localhost/orgs/acme-dev/projects?archiveState=all'),
    );

    expect(result.archiveState).toBe('all');
    const fetchPaths: string[] = fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]));
    expect(fetchPaths).toContain(browserAllProjectCountPath);
    expect(fetchPaths).toContain(browserAllProjectsPath);
  });
});

function createProjectsFetchMock(): Mock<FetchImplementation> {
  return vi.fn<FetchImplementation>().mockImplementation(async (input: string | URL | Request): Promise<Response> => {
    await Promise.resolve();
    const path: string = readFetchPath(input);
    if (path === '/v1/orgs') {
      return createJsonResponse(createOrganizationListResponse());
    }
    if (path === '/v1/whoami') {
      return createJsonResponse(createWhoamiResponse(['project.read']));
    }
    if (path.startsWith('/v1/projects?')) {
      return createJsonResponse(createProjectListResponse());
    }

    throw new Error(`Unexpected fetch path: ${path}`);
  });
}

function createProjectListResponse(): object {
  return {
    detail: 'overview',
    pagination: {
      page: 1,
      perPage: 10,
      totalItems: 1,
      totalPages: 1,
    },
    projects: [
      {
        archivedAt: null,
        canManageArchive: false,
        canManageLifecycle: false,
        canReadDeployments: false,
        createdAt: '2026-04-20T08:00:00.000Z',
        environmentName: 'production',
        id: 'proj_123',
        lastDeploymentCreatedAt: '2026-04-21T08:00:00.000Z',
        lifecycleAction: null,
        lifecycleDisabledReason: null,
        lifecycleState: 'running',
        name: 'billing',
        openTargets: [
          {
            environmentName: 'production',
            routeUrl: 'https://billing.apps.localhost',
            serviceName: 'web',
          },
        ],
        organizationId: 'org_123',
        routeUrl: 'https://billing.apps.localhost',
        serviceCount: 2,
        status: 'healthy',
        updatedAt: '2026-04-21T09:00:00.000Z',
      },
    ],
  };
}
