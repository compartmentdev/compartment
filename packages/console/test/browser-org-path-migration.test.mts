import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BrowserAuditEventsPageResult } from '../src/services/browser-audit-events.service.types';
import type { BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';
import type { BrowserProjectOverviewPageResult } from '../src/services/browser-project-overview.service.types';
import type { BrowserDeploymentHistoryPageResult } from '../src/services/browser-deployment-history.service.types';
import { loadAuditEventsPageData } from '../src/features/audit-events/audit-events-loader';
import { loadDeploymentHistoryPageData } from '../src/features/deployment-history/deployment-history-loader';
import { loadOnboardingPage } from '../src/features/onboarding/onboarding-page';
import type { OnboardingPageData } from '../src/features/onboarding/onboarding-page-data.types';
import { OnboardingOrganizationContextPanel } from '../src/features/onboarding/onboarding-organization-context-panel';
import { loadProjectCreatePage } from '../src/features/onboarding/project-create-page';
import { loadProjectOverviewPageData } from '../src/features/projects/project-overview-loader';
import { loadProjectsPageData, loadProjectsPageDataForUrl } from '../src/features/projects/projects-loader';
import { ProjectsView } from '../src/features/projects/projects-view';
import { browserQueryClient } from '../src/lib/browser-query-client';
import {
  createLoaderArgs,
  createOrganizationListResponse,
  readFetchPath,
  type BrowserFetchCall,
  type FetchImplementation,
} from './browser-client-pages.helpers';
import { createJsonResponse } from './browser-test.fixtures';

type ScopedOrgRouteResult =
  | BrowserAuditEventsPageResult
  | BrowserDeploymentHistoryPageResult
  | BrowserProjectOverviewPageResult
  | OnboardingPageData;

interface ScopedOrgRouteCase {
  load: () => Promise<ScopedOrgRouteResult>;
}

describe('browser org path migration', (): void => {
  afterEach((): void => {
    browserQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it('ignores legacy organization query params for scoped console deep links', async (): Promise<void> => {
    const cases: ScopedOrgRouteCase[] = [
      {
        load: async (): Promise<ScopedOrgRouteResult> =>
          await loadProjectOverviewPageData(
            createLoaderArgs(
              new Request('http://console.localhost/projects/billing?organization=acme-dev&environmentName=production'),
              { projectName: 'billing' },
            ),
          ),
      },
      {
        load: async (): Promise<ScopedOrgRouteResult> =>
          await loadDeploymentHistoryPageData(
            createLoaderArgs(
              new Request(
                'http://console.localhost/projects/billing/deployments?organization=acme-dev&environmentName=production',
              ),
              { projectName: 'billing' },
            ),
          ),
      },
      {
        load: async (): Promise<ScopedOrgRouteResult> =>
          await loadAuditEventsPageData(
            createLoaderArgs(
              new Request('http://console.localhost/audit?organization=acme-dev&actor=admin%40example.com'),
            ),
          ),
      },
      {
        load: async (): Promise<ScopedOrgRouteResult> =>
          await loadOnboardingPage(
            createLoaderArgs(
              new Request('http://console.localhost/onboarding?organization=acme-dev&method=cli&step=source'),
            ),
          ),
      },
      {
        load: async (): Promise<ScopedOrgRouteResult> =>
          await loadProjectCreatePage(
            createLoaderArgs(
              new Request('http://console.localhost/projects/create?organization=acme-dev&method=cli&step=source'),
            ),
          ),
      },
    ];

    for (const routeCase of cases) {
      browserQueryClient.clear();
      const fetchMock: Mock<FetchImplementation> = createMultiOrgUnselectedFetchMock();
      vi.stubGlobal('document', { cookie: '' });
      vi.stubGlobal('fetch', fetchMock);

      const result: ScopedOrgRouteResult = await routeCase.load();

      expect(result.selectedOrganizationSlug).toBeNull();
      expect(result.organizationContext).toEqual({
        kind: 'organization_required',
        requestedOrganizationSlug: null,
        selectedOrganizationSlug: null,
      });
      expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
        '/v1/orgs',
        '/v1/whoami',
      ]);
    }
  });

  it('ignores legacy organization query params on projects routes', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgUnselectedFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectsPageResult = await loadProjectsPageData(
      createLoaderArgs(new Request('http://console.localhost/projects?organization=hidden-org')),
    );

    expect(result.selectedOrganizationSlug).toBeNull();
    expect(result.organizationContext).toEqual({
      kind: 'organization_required',
      requestedOrganizationSlug: null,
      selectedOrganizationSlug: null,
    });
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('shows an explicit organization unavailable state for stale organization path params', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createSingleOrgUnavailableFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectsPageResult = await loadProjectsPageDataForUrl(
      new URL('http://console.localhost/orgs/hidden-org/projects'),
    );

    expect(result.selectedOrganizationSlug).toBeNull();
    expect(result.organizationContext).toEqual({
      kind: 'organization_unavailable',
      requestedOrganizationSlug: 'hidden-org',
      selectedOrganizationSlug: null,
    });
    expect(result.showOrganizationSelector).toBe(false);
    expect(result.projects).toEqual([]);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);

    const markup: string = renderToStaticMarkup(
      createElement(ProjectsView, {
        data: result,
        onNavigate: (): void => undefined,
        onProjectAction: async (): Promise<void> => await Promise.resolve(),
      }),
    );
    expect(markup).toContain('Organization unavailable');
    expect(markup).not.toContain('Deploy my first project');
    expect(markup).not.toContain('Search projects');
  });

  it('requires organization context before loading projects for multi-org sessions', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgUnselectedFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectsPageResult = await loadProjectsPageDataForUrl(
      new URL('http://console.localhost/projects'),
    );

    expect(result.selectedOrganizationSlug).toBeNull();
    expect(result.organizationContext).toEqual({
      kind: 'organization_required',
      requestedOrganizationSlug: null,
      selectedOrganizationSlug: null,
    });
    expect(result.showOrganizationSelector).toBe(true);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('does not start onboarding before multi-org organization context is selected', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgUnselectedFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: OnboardingPageData = await loadOnboardingPage(
      createLoaderArgs(new Request('http://console.localhost/onboarding')),
    );

    expect(result.organizationContext.kind).toBe('organization_required');
    expect(result.selectedOrganizationSlug).toBeNull();
    expect(result.projectsHref).toBe('/');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('does not start project creation before multi-org organization context is selected', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgUnselectedFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: OnboardingPageData = await loadProjectCreatePage(
      createLoaderArgs(new Request('http://console.localhost/projects/create')),
    );

    expect(result.organizationContext.kind).toBe('organization_required');
    expect(result.selectedOrganizationSlug).toBeNull();
    expect(result.projectsHref).toBe('/');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('keeps onboarding skip navigation on the selected organization path', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createSelectedOrgFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: OnboardingPageData = await loadOnboardingPage(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/onboarding')),
    );

    expect(result.organizationContext.kind).toBe('selected');
    expect(result.selectedOrganizationSlug).toBe('acme-dev');
    expect(result.projectsHref).toBe('/orgs/acme-dev/projects');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('renders onboarding organization recovery without the first-deploy flow', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(OnboardingOrganizationContextPanel, {
        context: {
          kind: 'organization_required',
          requestedOrganizationSlug: null,
          selectedOrganizationSlug: null,
        },
        data: {
          flowSearch: '?method=cli&step=source',
          organizationContext: {
            kind: 'organization_required',
            requestedOrganizationSlug: null,
            selectedOrganizationSlug: null,
          },
          organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
          principalEmail: 'admin@example.com',
          projectsHref: '/',
          selectedOrganizationSlug: null,
          showOrganizationSelector: true,
        },
        flowPathname: '/onboarding',
      }),
    );

    expect(html).toContain('Choose an organization');
    expect(html).toContain('href="/orgs/acme-dev/onboarding?method=cli&amp;step=source"');
    expect(html).not.toContain('Ship your first app');
  });

  it('keeps root chooser organization recovery on onboarding when start-onboarding is pending', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(ProjectsView, {
        data: {
          archiveState: 'active',
          currentOrganizationPermissions: [],
          organizationContext: {
            kind: 'organization_required',
            requestedOrganizationSlug: null,
            selectedOrganizationSlug: null,
          },
          organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
          page: 1,
          pageSize: 10,
          pageSizeOptions: [10, 20, 50],
          principalEmail: 'admin@example.com',
          projectCount: 0,
          projects: [],
          searchQuery: '',
          selectedOrganizationSlug: null,
          showOrganizationSelector: true,
          sortBy: 'updated',
          sortDirection: 'desc',
          startOnboarding: true,
          totalPages: 1,
          totalProjects: 0,
        },
        onNavigate: (): void => undefined,
        onProjectAction: async (): Promise<void> => await Promise.resolve(),
      }),
    );

    expect(markup).toContain('Choose an organization');
    expect(markup).toContain('href="/orgs/acme-dev/onboarding"');
  });
});

function createMultiOrgUnselectedFetchMock(): Mock<FetchImplementation> {
  return vi.fn<FetchImplementation>(async (input: string | URL | Request): Promise<Response> => {
    await Promise.resolve();
    const path: string = readFetchPath(input);
    if (path === '/v1/orgs') {
      return createJsonResponse({
        organizations: [
          { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
          { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
        ],
      });
    }
    if (path === '/v1/whoami') {
      return createJsonResponse({
        currentOrganization: null,
        currentOrganizationPermissions: [],
        principal: { email: 'admin@example.com', id: 'prn_123', type: 'user' },
      });
    }

    throw new Error(`Unexpected browser API request: ${path}`);
  });
}

function createSelectedOrgFetchMock(): Mock<FetchImplementation> {
  return vi.fn<FetchImplementation>(async (input: string | URL | Request): Promise<Response> => {
    await Promise.resolve();
    const path: string = readFetchPath(input);
    if (path === '/v1/orgs') {
      return createJsonResponse(createOrganizationListResponse());
    }
    if (path === '/v1/whoami') {
      return createJsonResponse({
        currentOrganization: { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
        currentOrganizationPermissions: [],
        principal: { email: 'admin@example.com', id: 'prn_123', type: 'user' },
      });
    }

    throw new Error(`Unexpected browser API request: ${path}`);
  });
}

function createSingleOrgUnavailableFetchMock(): Mock<FetchImplementation> {
  return vi.fn<FetchImplementation>(async (input: string | URL | Request): Promise<Response> => {
    await Promise.resolve();
    const path: string = readFetchPath(input);
    if (path === '/v1/orgs') {
      return createJsonResponse(createOrganizationListResponse());
    }
    if (path === '/v1/whoami') {
      return createJsonResponse({
        currentOrganization: null,
        currentOrganizationPermissions: [],
        principal: {
          email: 'admin@example.com',
          id: 'prn_123',
          type: 'user',
        },
      });
    }

    throw new Error(`Unexpected browser API request: ${path}`);
  });
}
