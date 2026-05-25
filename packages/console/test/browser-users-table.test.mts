import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserUsersPageResult, BrowserUsersUser } from '../src/services/browser-users.service.types';
import type { BrowserSoftNavigateHandler } from '../src/browser-soft-navigation';
import type { UserActionHandler } from '../src/features/users/user-actions';
import { UsersTable } from '../src/features/users/users-table';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('browser users table', (): void => {
  it('renders blocked user state and access actions', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(UsersTable, {
        data: createUsersPageResult({
          users: [
            createUser({ access: 'blocked', email: 'blocked@example.com', id: 'usr_blocked' }),
            createUser({ access: 'allowed', email: 'viewer@example.com', id: 'usr_viewer' }),
          ],
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onUserAction: vi.fn<UserActionHandler>(),
      }),
    );

    expect(html).toContain('Blocked');
    expect(html).toContain('Open actions for blocked@example.com');
    expect(html).toContain('Open actions for viewer@example.com');
  });

  it('renders automation users as system-managed read-only rows', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(UsersTable, {
        data: createUsersPageResult({
          users: [createUser({ email: 'git-source+src_123@compartment.internal', type: 'automation' })],
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onUserAction: vi.fn<UserActionHandler>(),
      }),
    );

    expect(html).toContain('System');
    expect(html).toContain('Managed by Git source');
    expect(html).not.toContain('Reset password');
    expect(html).not.toContain('Remove');
    expect(html).not.toContain('Block');
  });

  it('does not render user row action controls for invite-only principals', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(UsersTable, {
        data: createUsersPageResult({
          currentOrganizationPermissions: ['organization.user.invite'],
          users: [createUser({ email: 'viewer@example.com' })],
        }),
        onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
        onUserAction: vi.fn<UserActionHandler>(),
      }),
    );

    expect(html).toContain('View');
    expect(html).not.toContain('Open actions for viewer@example.com');
  });
});

function createUsersPageResult(overrides?: Partial<BrowserUsersPageResult>): BrowserUsersPageResult {
  return {
    availableGroups: [],
    availableRoles: [],
    currentOrganizationPermissions: [
      'organization.user.block',
      'organization.user.credentials.reset',
      'organization.user.remove',
    ],
    mode: 'list',
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
    selectedUserAccess: null,
    selectedUserEmail: null,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    scopeProjects: [],
    sortBy: 'email',
    sortDirection: 'asc',
    totalPages: 1,
    totalUsers: 1,
    users: [createUser()],
    ...overrides,
  };
}

function createUser(overrides?: Partial<BrowserUsersUser>): BrowserUsersUser {
  const user: BrowserUsersUser = {
    access: 'allowed',
    accessSummary: 'Limited view',
    directAccessScopeLabels: [],
    email: 'viewer@example.com',
    groupCount: 0,
    groupNames: [],
    id: 'usr_123',
    roleNames: ['viewer'],
    status: 'active',
    type: 'user',
    ...overrides,
  };

  return user;
}
