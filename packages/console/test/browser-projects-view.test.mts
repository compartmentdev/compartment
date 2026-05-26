import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectsView } from '../src/features/projects/projects-view';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';

describe('browser projects view', (): void => {
  it('shows an add project toolbar action when the organization already has projects', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(ProjectsView, {
        data: createProjectsPageResult(),
        onNavigate: (): void => undefined,
        onProjectAction: async (): Promise<void> => await Promise.resolve(),
      }),
    );

    expect(html).toContain('Add project');
    expect(html).toContain('href="/orgs/acme-dev/projects/create"');
    expect(html).toContain('button-accent-surface');
    expect(html).not.toContain('shadow-sm');
    expect(html).toContain('lucide-plus');
    expect(html).not.toContain('lucide-folder-plus');
  });

  it('keeps the add project toolbar action for filtered empty results', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(ProjectsView, {
        data: createProjectsPageResult({
          projectCount: 2,
          projects: [],
          searchQuery: 'no-match',
          totalProjects: 0,
        }),
        onNavigate: (): void => undefined,
        onProjectAction: async (): Promise<void> => await Promise.resolve(),
      }),
    );

    expect(html).toContain('Add project');
    expect(html).toContain('href="/orgs/acme-dev/projects/create"');
    expect(html).toContain('No projects found.');
    expect(html).not.toContain('Deploy my first project');
  });

  it('keeps the add project toolbar action when only archived projects exist', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(ProjectsView, {
        data: createProjectsPageResult({
          projectCount: 1,
          projects: [],
          totalProjects: 0,
        }),
        onNavigate: (): void => undefined,
        onProjectAction: async (): Promise<void> => await Promise.resolve(),
      }),
    );

    expect(html).toContain('Add project');
    expect(html).toContain('href="/orgs/acme-dev/projects/create"');
    expect(html).not.toContain('Deploy my first project');
  });

  it('renders the project header before full-width search and lifted state tabs', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(ProjectsView, {
        data: createProjectsPageResult(),
        onNavigate: (): void => undefined,
        onProjectAction: async (): Promise<void> => await Promise.resolve(),
      }),
    );

    expect(html).toContain('Search projects');
    expect(html).toContain('Active');
    expect(html).toContain('Archived');
    expect(html).toContain('All');
    expect(html).toContain('Add project');
    expect(html.indexOf('Projects')).toBeLessThan(html.indexOf('Add project'));
    expect(html.indexOf('Add project')).toBeLessThan(html.indexOf('Search projects'));
    expect(html.indexOf('Search projects')).toBeLessThan(html.indexOf('Active'));
    expect(html.indexOf('Archived')).toBeLessThan(html.indexOf('>All</span>'));
  });

  it('keeps the add project action on the all projects tab', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(ProjectsView, {
        data: createProjectsPageResult({
          archiveState: 'all',
        }),
        onNavigate: (): void => undefined,
        onProjectAction: async (): Promise<void> => await Promise.resolve(),
      }),
    );

    expect(html).toContain('Add project');
    expect(html).toContain('href="/orgs/acme-dev/projects/create"');
    expect(html).toContain('href="/orgs/acme-dev/projects?archiveState=all"');
  });

  it('omits the add project toolbar action for archived projects', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(ProjectsView, {
        data: createProjectsPageResult({
          archiveState: 'archived',
        }),
        onNavigate: (): void => undefined,
        onProjectAction: async (): Promise<void> => await Promise.resolve(),
      }),
    );

    expect(html).not.toContain('Add project');
  });

  it('keeps project open targets behind the row actions menu', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(ProjectsView, {
        data: createProjectsPageResult({
          projects: [
            createProjectSummary({
              canManageArchive: false,
              lifecycleAction: null,
              openTargets: [
                {
                  environmentName: 'production',
                  routeUrl: 'https://billing.apps.localhost',
                  serviceName: 'web',
                },
              ],
            }),
          ],
        }),
        onNavigate: (): void => undefined,
        onProjectAction: async (): Promise<void> => await Promise.resolve(),
      }),
    );

    expect(html).toContain('Details');
    expect(html).toContain('aria-label="Open actions for billing"');
    expect(html).toContain('lucide-ellipsis');
    expect(html).not.toContain('Choose environment to open');
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
    openTargets: [],
    routeUrl: 'https://billing.apps.localhost',
    serviceCount: 2,
    status: 'healthy',
    updatedAt: '2026-04-21T09:00:00.000Z',
    ...overrides,
  };
}
