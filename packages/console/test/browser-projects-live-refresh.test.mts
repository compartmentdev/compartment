import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';
import { shouldRefreshProjectsPage } from '../src/features/projects/projects-live-refresh.helpers';
import { refreshProjectStatuses } from '../src/features/projects/projects-status-refresh';
import { createJsonResponse } from './browser-test.fixtures';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('browser projects live refresh', (): void => {
  it('polls active project pages without waiting for an updating row', (): void => {
    expect(shouldRefreshProjectsPage(createProjectsPageResult())).toBe(true);
    expect(
      shouldRefreshProjectsPage(
        createProjectsPageResult({
          archiveState: 'archived',
        }),
      ),
    ).toBe(false);
    expect(shouldRefreshProjectsPage(createProjectsPageResult({ projects: [] }))).toBe(false);
  });

  it('refreshes only project status fields for the visible rows', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        const path: string = readFetchPath(input);
        if (path === '/v1/projects?detail=status&projectIds=proj_123') {
          return await Promise.resolve(
            createJsonResponse({
              detail: 'status',
              projects: [
                {
                  id: 'proj_123',
                  lifecycleAction: null,
                  lifecycleDisabledReason: 'Updating',
                  lifecycleState: 'updating',
                  openTargets: [],
                  routeUrl: null,
                  status: 'updating',
                },
              ],
            }),
          );
        }

        throw new Error(`Unexpected fetch path: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectsPageResult = await refreshProjectStatuses(createProjectsPageResult());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.projects[0]).toMatchObject({
      id: 'proj_123',
      lifecycleAction: null,
      lifecycleDisabledReason: 'Updating',
      lifecycleState: 'updating',
      routeUrl: null,
      status: 'updating',
    } satisfies Partial<BrowserProjectSummary>);
    expect(result.projects[0]?.serviceCount).toBe(2);
    expect(result.projects[0]?.name).toBe('billing');
  });

  it('drops archived rows from the active page during status refresh', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (): Promise<Response> => {
        return await Promise.resolve(
          createJsonResponse({
            detail: 'status',
            projects: [
              {
                id: 'proj_123',
                lifecycleAction: null,
                lifecycleDisabledReason: null,
                lifecycleState: null,
                openTargets: [],
                routeUrl: null,
                status: 'archived',
              },
            ],
          }),
        );
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectsPageResult = await refreshProjectStatuses(createProjectsPageResult());

    expect(result.projects).toEqual([]);
    expect(result.totalProjects).toBe(0);
    expect(result.totalPages).toBe(1);
  });

  it('drops missing rows from the active page during status refresh', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (): Promise<Response> => {
        return await Promise.resolve(
          createJsonResponse({
            detail: 'status',
            projects: [],
          }),
        );
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectsPageResult = await refreshProjectStatuses(createProjectsPageResult());

    expect(result.projects).toEqual([]);
    expect(result.totalProjects).toBe(0);
    expect(result.totalPages).toBe(1);
  });
});

function createProjectsPageResult(overrides?: Partial<BrowserProjectsPageResult>): BrowserProjectsPageResult {
  return {
    projects: [
      {
        canManageArchive: true,
        canManageLifecycle: true,
        environmentName: 'production',
        id: 'proj_123',
        lastDeploymentCreatedAt: '2026-04-21T08:00:00.000Z',
        lifecycleAction: 'stop',
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
        routeUrl: 'https://billing.apps.localhost',
        serviceCount: 2,
        status: 'healthy',
        updatedAt: '2026-04-21T09:00:00.000Z',
      },
    ],
    archiveState: 'active',
    currentOrganizationPermissions: ['project.archive', 'project.lifecycle.write'],
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'updated',
    sortDirection: 'desc',
    totalPages: 1,
    totalProjects: 1,
    ...overrides,
  };
}

function readFetchPath(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return new URL(input, 'http://console.localhost').pathname + new URL(input, 'http://console.localhost').search;
  }
  if (input instanceof URL) {
    return input.pathname + input.search;
  }

  return new URL(input.url).pathname + new URL(input.url).search;
}
