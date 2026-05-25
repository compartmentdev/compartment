import * as React from 'react';
import { compartmentCsrfCookieName, compartmentCsrfHeaderName } from '@compartment/contracts/browser';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createJsonResponse } from './browser-test.fixtures';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';
import type { BrowserSoftNavigateHandler } from '../src/browser-soft-navigation';
import {
  readProjectActionConfirmationMessage,
  runProjectAction,
  type ProjectActionHandler,
} from '../src/features/projects/project-actions';
import { ProjectsTable } from '../src/features/projects/projects-table';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('browser projects table', (): void => {
  it('renders the archive action for active manageable projects', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectsTable, {
        data: createProjectsPageResult(),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onProjectAction: vi.fn<ProjectActionHandler>(),
      }),
    );

    expect(html).toContain('billing');
    expect(html).toContain('href="/orgs/acme-dev/projects/billing"');
    expect(html).toContain('Overview');
    expect(html).toContain('href="https://billing.apps.localhost" rel="noreferrer" target="_blank">Open</a>');
    expect(html).toContain('>Open<');
    expect(html).toContain('Choose environment to open');
    expect(html).toContain('>Actions<');
    expect(html).toContain('block whitespace-nowrap');
  });

  it('keeps organization in project links for multi-org sessions', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectsTable, {
        data: createProjectsPageResult({
          organizations: [
            { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
            { id: 'org_456', name: 'Beta', slug: 'beta' },
          ],
          showOrganizationSelector: true,
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onProjectAction: vi.fn<ProjectActionHandler>(),
      }),
    );

    expect(html).toContain('href="/orgs/acme-dev/projects/billing"');
    expect(html).toContain('href="/orgs/acme-dev/projects?sortBy=project&amp;sortDirection=asc"');
  });

  it('requires exact-match confirmation for destructive project actions only', (): void => {
    expect(readProjectActionConfirmationMessage('archive', 'billing')).toBe('Type billing to archive this project.');
    expect(readProjectActionConfirmationMessage('delete', 'billing')).toBe(
      'Type billing to permanently remove this project.',
    );
    expect(readProjectActionConfirmationMessage('stop', 'billing')).toBeNull();
  });

  it('submits archive action through the project action API', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockResolvedValue(
      createJsonResponse({
        project: {
          archivedAt: '2026-04-21T10:00:00.000Z',
          createdAt: '2026-04-21T08:00:00.000Z',
          id: 'prj_123',
          name: 'billing',
          organizationId: 'org_123',
          updatedAt: '2026-04-21T10:00:00.000Z',
        },
      }),
    );

    vi.stubGlobal('document', { cookie: `${compartmentCsrfCookieName}=csrf-token` });
    vi.stubGlobal('fetch', fetchMock);

    await runProjectAction('archive', 'billing', 'acme-dev');

    const requestInput: string | URL | Request | undefined = fetchMock.mock.calls[0]?.[0];

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestInput).toBe('/v1/projects/billing/archive');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(compartmentCsrfHeaderName)).toBe('csrf-token');
  });

  it('submits stop action through the project action API', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockResolvedValue(
      createJsonResponse({
        action: 'stop',
        deployments: [],
        environment: {
          createdAt: '2026-04-21T08:00:00.000Z',
          id: 'env_123',
          name: 'production',
          projectId: 'prj_123',
          updatedAt: '2026-04-21T08:00:00.000Z',
        },
        project: {
          archivedAt: null,
          createdAt: '2026-04-21T08:00:00.000Z',
          id: 'prj_123',
          name: 'billing',
          organizationId: 'org_123',
          updatedAt: '2026-04-21T10:00:00.000Z',
        },
        state: 'stopped',
      }),
    );

    vi.stubGlobal('document', { cookie: `${compartmentCsrfCookieName}=csrf-token` });
    vi.stubGlobal('fetch', fetchMock);

    await runProjectAction('stop', 'billing', 'acme-dev');

    const requestInput: string | URL | Request | undefined = fetchMock.mock.calls[0]?.[0];

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestInput).toBe('/v1/projects/billing/stop');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(compartmentCsrfHeaderName)).toBe('csrf-token');
  });

  it('keeps overview and open dropdown actions for viewer projects rows', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectsTable, {
        data: createProjectsPageResult({
          currentOrganizationPermissions: [],
          projects: [
            createProjectSummary({
              canManageArchive: false,
              canManageLifecycle: false,
              lifecycleAction: null,
              routeUrl: 'https://billing.apps.localhost',
            }),
          ],
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onProjectAction: vi.fn<ProjectActionHandler>(),
      }),
    );

    expect(html).toContain('href="/orgs/acme-dev/projects/billing"');
    expect(html).toContain('Overview');
    expect(html).toContain('href="https://billing.apps.localhost"');
    expect(html).toContain('>Open<');
    expect(html).toContain('Choose environment to open');
  });

  it('shows missing live routes with the summary environment label', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectsTable, {
        data: createProjectsPageResult({
          projects: [
            createProjectSummary({
              lifecycleAction: null,
              lifecycleDisabledReason: 'Needs attention',
              lifecycleState: 'needs_attention',
              openTargets: [],
              routeUrl: null,
              status: 'needs_attention',
            }),
          ],
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onProjectAction: vi.fn<ProjectActionHandler>(),
      }),
    );

    expect(html).toContain('Overview');
    expect(html).not.toContain('href="https://billing.apps.localhost"');
    expect(html).not.toContain('No live route');
  });

  it('shows a no-route badge for running projects when the summary environment has no route', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectsTable, {
        data: createProjectsPageResult({
          projects: [
            createProjectSummary({
              openTargets: [],
              routeUrl: null,
            }),
          ],
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onProjectAction: vi.fn<ProjectActionHandler>(),
      }),
    );

    expect(html).toContain('No live route');
    expect(html).not.toContain('href="https://billing.apps.localhost"');
  });

  it('keeps the selected organization in the empty projects onboarding link for single-org sessions', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectsTable, {
        data: createProjectsPageResult({
          projectCount: 0,
          projects: [],
          totalProjects: 0,
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onProjectAction: vi.fn<ProjectActionHandler>(),
      }),
    );

    expect(html).toContain('Deploy my first project');
    expect(html).toContain('href="/orgs/acme-dev/projects/create"');
  });

  it('preserves the selected organization in the empty projects onboarding link for multi-org sessions', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectsTable, {
        data: createProjectsPageResult({
          organizations: [
            { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
            { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
          ],
          projectCount: 0,
          projects: [],
          showOrganizationSelector: true,
          totalProjects: 0,
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onProjectAction: vi.fn<ProjectActionHandler>(),
      }),
    );

    expect(html).toContain('Deploy my first project');
    expect(html).toContain('href="/orgs/acme-dev/projects/create"');
  });

  it('omits the empty projects onboarding link for archived projects', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectsTable, {
        data: createProjectsPageResult({
          archiveState: 'archived',
          projectCount: 0,
          projects: [],
          totalProjects: 0,
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onProjectAction: vi.fn<ProjectActionHandler>(),
      }),
    );

    expect(html).toContain('No projects found.');
    expect(html).not.toContain('Deploy my first project');
    expect(html).not.toContain('href="/orgs/acme-dev/projects/create"');
  });

  it('does not show the first-project CTA when the organization already has archived projects', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectsTable, {
        data: createProjectsPageResult({
          projectCount: 1,
          projects: [],
          totalProjects: 0,
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onProjectAction: vi.fn<ProjectActionHandler>(),
      }),
    );

    expect(html).toContain('No projects found.');
    expect(html).not.toContain('Deploy my first project');
  });
});

function createProjectsPageResult(overrides?: Partial<BrowserProjectsPageResult>): BrowserProjectsPageResult {
  return {
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
    projects: [createProjectSummary()],
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

function createProjectSummary(overrides?: Partial<BrowserProjectSummary>): BrowserProjectSummary {
  return {
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
        routeUrl: 'https://admin.billing.apps.localhost',
        serviceName: 'admin',
      },
      {
        environmentName: 'production',
        routeUrl: 'https://billing.apps.localhost',
        serviceName: 'web',
      },
      {
        environmentName: 'staging',
        routeUrl: 'https://admin.billing-staging.apps.localhost',
        serviceName: 'admin',
      },
      {
        environmentName: 'staging',
        routeUrl: 'https://billing-staging.apps.localhost',
        serviceName: 'web',
      },
    ],
    routeUrl: 'https://billing.apps.localhost',
    serviceCount: 2,
    status: 'healthy',
    updatedAt: '2026-04-21T09:00:00.000Z',
    ...overrides,
  };
}
