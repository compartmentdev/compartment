import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserSoftNavigateHandler } from '../src/browser-soft-navigation';
import type { BrowserProjectOverviewPageResult } from '../src/services/browser-project-overview.service.types';
import { ProjectOverviewView } from '../src/features/projects/project-overview-view';

describe('browser project overview', (): void => {
  it('renders environment switching and an environment-scoped deployments link', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectOverviewView, {
        data: createProjectOverviewPageResult(),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
      }),
    );

    expect(html).toContain('>Overview<');
    expect(html).toContain('lucide-boxes');
    expect(html).not.toContain('Project services, routes, and deployment status by environment.');
    expect(html).not.toContain('>Production details<');
    expect(html).toContain('gap-6 bg-background pb-8 pt-4');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/orgs/acme-dev/projects"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('title="billing">billing</span>');
    expect(html).toContain('aria-label="Project environment"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('>All</option>');
    expect(html).toContain('>Production</option>');
    expect(html).toContain('>Staging</option>');
    expect(html).not.toContain('aria-label="Project environments"');
    expect(html).toContain('href="/orgs/acme-dev/projects/billing/deployments?environmentName=production"');
    expect(html).toContain('>Production Deployments<');
    expect(html).toContain('overflow-hidden rounded-card border border-border bg-card');
    expect(html).toContain('sm:flex-row');
    expect(html).toContain('sm:justify-between');
    expect(html).not.toContain('&amp;serviceName=');
    expect(html).toContain('block whitespace-nowrap');
    expect(html).not.toContain(
      'href="/orgs/acme-dev/projects/billing/deployments?environmentName=production&amp;serviceName=web"',
    );
    expect(html).not.toContain('production / 1 service');
    expect(html).not.toContain('>Environment<');
    expect(html).not.toContain('>Actions<');
  });

  it('renders an all-environment overview selection', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectOverviewView, {
        data: createProjectOverviewPageResult({
          selectedEnvironmentName: null,
          services: [
            {
              environmentName: 'production',
              kind: 'web',
              lastDeploymentCreatedAt: '2026-05-06T08:20:00.000Z',
              name: 'web',
              routeUrl: 'https://billing.apps.localhost',
              status: 'healthy',
            },
            {
              environmentName: 'staging',
              kind: 'worker',
              lastDeploymentCreatedAt: null,
              name: 'worker',
              routeUrl: null,
              status: 'updating',
            },
          ],
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
      }),
    );

    expect(html).toContain('aria-label="Project environment"');
    expect(html).toContain('>All</option>');
    expect(html).toContain('>Environment<');
    expect(html).toContain('>Production<');
    expect(html).toContain('>Staging<');
    expect(html).not.toContain('/projects/billing/deployments?');
  });

  it('keeps organization in project links for multi-org sessions', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectOverviewView, {
        data: createProjectOverviewPageResult({
          currentOrganizationPermissions: [
            'deployment.read',
            'organization.audit.read',
            'organization.group.read',
            'organization.user.read',
          ],
          organizations: [
            { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
            { id: 'org_456', name: 'Beta', slug: 'beta' },
          ],
          showOrganizationSelector: true,
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
      }),
    );

    expect(html).toContain('href="/orgs/acme-dev/projects/billing/deployments?environmentName=production"');
    expect(html).toContain('href="/orgs/acme-dev/projects"');
    expect(html).toContain('href="/orgs/acme-dev/users"');
    expect(html).toContain('href="/orgs/acme-dev/groups"');
    expect(html).toContain('href="/orgs/acme-dev/audit"');
  });

  it('hides deployment actions when overview access does not include deployment.read', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(ProjectOverviewView, {
        data: createProjectOverviewPageResult({
          canReadDeployments: false,
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
      }),
    );

    expect(html).not.toContain('>Production Deployments<');
    expect(html).not.toContain('/projects/billing/deployments?');
  });
});

function createProjectOverviewPageResult(
  overrides?: Partial<BrowserProjectOverviewPageResult>,
): BrowserProjectOverviewPageResult {
  return {
    canReadDeployments: true,
    currentOrganizationPermissions: ['deployment.read'],
    environments: [
      { name: 'production', status: 'healthy' },
      { name: 'staging', status: 'updating' },
    ],
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    project: {
      canManageArchive: true,
      canManageLifecycle: true,
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
      routeUrl: 'https://billing.apps.localhost',
      serviceCount: 3,
      status: 'healthy',
      updatedAt: '2026-05-06T08:20:00.000Z',
    },
    projectName: 'billing',
    selectedEnvironmentName: 'production',
    selectedOrganizationSlug: 'acme-dev',
    services: [
      {
        environmentName: 'production',
        kind: 'web',
        lastDeploymentCreatedAt: '2026-05-06T08:20:00.000Z',
        name: 'web',
        routeUrl: 'https://billing.apps.localhost',
        status: 'healthy',
      },
    ],
    showOrganizationSelector: false,
    ...overrides,
  };
}
