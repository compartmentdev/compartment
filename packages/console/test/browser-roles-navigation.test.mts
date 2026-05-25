import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserSoftNavigateHandler } from '../src/browser-soft-navigation';
import type { BrowserOrganizationOption } from '../src/services/browser-organization.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';
import { closeRolesDrawerAfterMutation, shouldRevalidateRolesPage } from '../src/features/roles/roles-page.navigation';
import type { RolesPageState } from '../src/features/roles/roles-page.state';

interface RolesRevalidationInput {
  currentPath: string;
  defaultShouldRevalidate?: boolean | undefined;
  nextPath: string;
}

describe('browser roles route navigation', (): void => {
  it('keeps role drawer close navigation on the current query data', (): void => {
    expect(
      shouldRevalidateRolesPage(
        createRolesRevalidationArgs({
          currentPath: '/orgs/acme-dev/roles?mode=edit&roleId=rol_123',
          nextPath: '/orgs/acme-dev/roles',
        }),
      ),
    ).toBe(false);
  });

  it('revalidates role create close navigation', (): void => {
    expect(
      shouldRevalidateRolesPage(
        createRolesRevalidationArgs({
          currentPath: '/roles?organization=acme-dev&mode=create',
          nextPath: '/roles?organization=acme-dev',
        }),
      ),
    ).toBe(true);
  });

  it('revalidates legacy query-organization changes when closing a role drawer', (): void => {
    expect(
      shouldRevalidateRolesPage(
        createRolesRevalidationArgs({
          currentPath: '/roles?organization=acme-dev&mode=edit&roleId=rol_123',
          nextPath: '/roles?organization=acme-prod',
        }),
      ),
    ).toBe(true);
  });

  it('keeps normal role drawer navigations on router revalidation', (): void => {
    expect(
      shouldRevalidateRolesPage(
        createRolesRevalidationArgs({
          currentPath: '/orgs/acme-dev/roles',
          nextPath: '/orgs/acme-dev/roles?mode=detail&roleId=rol_123',
        }),
      ),
    ).toBe(true);
    expect(
      shouldRevalidateRolesPage(
        createRolesRevalidationArgs({
          currentPath: '/orgs/acme-dev/roles?mode=edit&roleId=rol_123',
          nextPath: '/roles?organization=acme-prod',
        }),
      ),
    ).toBe(true);
  });

  it('preserves return targets when closing roles after mutation', (): void => {
    const state: RolesPageState = createRolesPageState({
      backHref: '/orgs/acme-dev/users?userEmail=viewer%40example.com',
      mode: 'edit',
      roleId: 'rol_123',
    });

    closeRolesDrawerAfterMutation(state);

    expect(state.setData).toHaveBeenCalledTimes(1);
    expect(state.onNavigate).toHaveBeenCalledWith(
      '/orgs/acme-dev/roles?returnTo=%2Forgs%2Facme-dev%2Fusers%3FuserEmail%3Dviewer%2540example.com',
    );
  });
});

function createRolesRevalidationArgs(input: RolesRevalidationInput): ShouldRevalidateFunctionArgs {
  return {
    currentParams: {},
    currentUrl: new URL(input.currentPath, 'http://console.localhost'),
    defaultShouldRevalidate: input.defaultShouldRevalidate ?? true,
    nextParams: {},
    nextUrl: new URL(input.nextPath, 'http://console.localhost'),
  };
}

function createRolesPageState(overrides: Partial<BrowserRolesPageResult> = {}): RolesPageState {
  return {
    data: createRolesPageResult(overrides),
    description: '',
    drawerErrorMessage: undefined,
    name: '',
    onNavigate: vi.fn<BrowserSoftNavigateHandler>(),
    selectedPermissions: [],
    setData: vi.fn(),
    setDescription: vi.fn(),
    setDrawerErrorMessage: vi.fn(),
    setName: vi.fn(),
    setSelectedPermissions: vi.fn(),
  };
}

function createRolesPageResult(overrides: Partial<BrowserRolesPageResult> = {}): BrowserRolesPageResult {
  return {
    currentOrganizationPermissions: ['organization.role.read'],
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    permissionKeys: ['project.read'],
    principalEmail: 'admin@example.com',
    role: null,
    roleId: null,
    roles: [],
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    ...overrides,
  };
}

function createOrganizationOption(): BrowserOrganizationOption {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}
