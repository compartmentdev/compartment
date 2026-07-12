import type { PermissionKey } from '@compartment/contracts/browser';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrowserConsoleSidebar } from '../src/components/browser-console-sidebar';
import {
  canInviteBrowserUsers,
  canReadBrowserGroups,
  canReadBrowserRoles,
  canReadBrowserUsers,
} from '../src/features/console/console-access';
import { ProjectArchiveStateSwitch } from '../src/features/projects/project-archive-state-switch';
import type { BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';
import { createConsoleAdminPermissions } from './browser-client-pages.helpers';

function projects(overrides?: Partial<BrowserProjectsPageResult>): BrowserProjectsPageResult {
  return {
    archiveState: 'active',
    currentOrganizationPermissions: ['project.archive'],
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 0,
    projects: [],
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'updated',
    sortDirection: 'desc',
    totalPages: 1,
    totalProjects: 0,
    ...overrides,
  };
}

describe('browser client navigation', (): void => {
  it('uses the viewer browser-console access rules for admin-only surfaces', (): void => {
    expect(canInviteBrowserUsers(['organization.user.invite'])).toBe(true);
    expect(canReadBrowserUsers(['organization.user.read'])).toBe(true);
    expect(canReadBrowserGroups(['organization.group.manage'])).toBe(true);
    expect(canReadBrowserRoles(['organization.role.manage'])).toBe(true);
  });
  it('preserves the selected organization in sidebar and brand navigation', (): void => {
    const permissions: PermissionKey[] = [
      ...createConsoleAdminPermissions(),
      'organization.audit.read',
    ] as PermissionKey[];
    const markup: string = renderToStaticMarkup(
      createElement(BrowserConsoleSidebar, {
        currentOrganizationPermissions: permissions,
        errorMessage: undefined,
        onError: (): void => undefined,
        organizationControl: null,
        page: 'projects',
        principalEmail: 'admin@example.com',
        projectCount: 1,
        selectedOrganizationSlug: 'acme-dev',
      }),
    );
    expect(markup).toContain('href="/orgs/acme-dev/projects"');
    expect(markup).toContain('href="/orgs/acme-dev/users"');
    expect(markup).toContain('href="/orgs/acme-dev/groups"');
    expect(markup).toContain('href="/orgs/acme-dev/audit"');
  });
  it('renders users sidebar navigation for invite-only principals', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(BrowserConsoleSidebar, {
        currentOrganizationPermissions: ['organization.user.invite'],
        errorMessage: undefined,
        onError: (): void => undefined,
        organizationControl: null,
        page: 'projects',
        principalEmail: 'admin@example.com',
        projectCount: 1,
        selectedOrganizationSlug: 'acme-dev',
      }),
    );
    expect(markup).toContain('href="/orgs/acme-dev/users"');
  });
  it('renders archived project navigation without current organization permissions', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(ProjectArchiveStateSwitch, {
        data: projects({ currentOrganizationPermissions: [] }),
        onNavigate: (): void => undefined,
      }),
    );
    expect(markup).toContain('Project state');
    expect(markup).toContain('Archived');
  });
});
