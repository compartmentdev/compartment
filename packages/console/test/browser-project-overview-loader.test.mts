import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  BrowserProjectOverviewPageResult,
  BrowserProjectOverviewService,
} from '../src/services/browser-project-overview.service.types';
import { loadProjectOverviewPageData } from '../src/features/projects/project-overview-loader';
import {
  createLoaderArgs,
  createOrganizationListResponse,
  createProjectCountResponse,
  createWhoamiResponse,
  readFetchPath,
  type FetchImplementation,
} from './browser-client-pages.helpers';
import { createJsonResponse } from './browser-test.fixtures';

const browserProjectCountPath: string =
  '/v1/projects?archiveState=active&detail=overview&orderBy=updatedAt&page=1&perPage=1&sort=desc';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('browser project overview loader', (): void => {
  it('loads unscoped project overview as the all-environment view', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === '/v1/projects/billing/overview') {
          return createJsonResponse(createProjectOverviewResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectOverviewPageResult = await loadProjectOverviewPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/projects/billing'), {
        projectName: 'billing',
      }),
    );

    expect(result.selectedEnvironmentName).toBeNull();
    expect(result.services.map(readServiceTestKey)).toEqual(['production:web', 'staging:worker']);
  });
});

function readServiceTestKey(service: BrowserProjectOverviewService): string {
  return `${service.environmentName}:${service.name}`;
}

function createProjectOverviewResponse(): object {
  return {
    environments: [
      {
        name: 'production',
        services: [
          {
            kind: 'web',
            lastDeploymentCreatedAt: '2026-05-06T08:20:00.000Z',
            name: 'web',
            routeUrl: 'https://billing.apps.localhost',
            status: 'healthy',
          },
        ],
        status: 'healthy',
      },
      {
        name: 'staging',
        services: [
          {
            kind: 'worker',
            lastDeploymentCreatedAt: null,
            name: 'worker',
            routeUrl: null,
            status: 'updating',
          },
        ],
        status: 'updating',
      },
    ],
    project: {
      archivedAt: null,
      canManageArchive: true,
      canManageLifecycle: true,
      canReadDeployments: true,
      createdAt: '2026-05-06T08:00:00.000Z',
      environmentName: 'production',
      id: 'proj_123',
      lastDeploymentCreatedAt: '2026-05-06T08:20:00.000Z',
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
      organizationId: 'org_123',
      routeUrl: 'https://billing.apps.localhost',
      serviceCount: 2,
      status: 'healthy',
      updatedAt: '2026-05-06T08:20:00.000Z',
    },
  };
}
