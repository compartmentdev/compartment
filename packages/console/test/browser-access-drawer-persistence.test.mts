// @vitest-environment jsdom

import * as React from 'react';
import { act, type ReactElement } from 'react';
import type {
  AccessGroupListRow,
  AccessRoleListRow,
  AccessRoleSummary,
  PermissionKey,
  UserAccessDetail,
} from '@compartment/contracts/browser';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { NavigateFunction } from 'react-router';
import { GroupsPageContent } from '../src/features/groups/groups-page.sections';
import { useGroupsPageState, type GroupsPageState } from '../src/features/groups/groups-page.state';
import { RolesPageContent } from '../src/features/roles/roles-page.sections';
import { useRolesPageState, type RolesPageState } from '../src/features/roles/roles-page.state';
import { UserAccessPanel } from '../src/features/users/user-access-panel';
import type { UserAccessPanelSetter } from '../src/features/users/user-access-panel.actions';
import type { BrowserSoftNavigateHandler } from '../src/browser-soft-navigation';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type { BrowserOrganizationOption } from '../src/services/browser-organization.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';
import type { BrowserUsersPageResult, BrowserUsersUser } from '../src/services/browser-users.service.types';

interface MountedDrawerProbe<TData> {
  container: HTMLDivElement;
  rerender: (data: TData) => Promise<void>;
  unmount: () => Promise<void>;
}

class MountedDrawerProbeValue<TData> implements MountedDrawerProbe<TData> {
  public readonly container: HTMLDivElement;
  private readonly renderProbe: (data: TData) => Promise<void>;
  private readonly root: Root;

  public constructor(container: HTMLDivElement, root: Root, renderProbe: (data: TData) => Promise<void>) {
    this.container = container;
    this.renderProbe = renderProbe;
    this.root = root;
  }

  public async rerender(data: TData): Promise<void> {
    await this.renderProbe(data);
  }

  public async unmount(): Promise<void> {
    await act(async (): Promise<void> => {
      this.root.unmount();
      await flushEffects();
    });
    this.container.remove();
  }
}

const createGroupFormSelector: string = 'form#create-group-form';

configureReactActEnvironment();

afterEach((): void => {
  document.body.innerHTML = '';
});

describe('access drawer persistence', (): void => {
  it('keeps the same groups drawer shell between create and detail modes', async (): Promise<void> => {
    const mountedProbe: MountedDrawerProbe<BrowserGroupsPageResult> = await mountDrawerProbe(
      createGroupsDrawerElement,
      createGroupsCreateResult(),
    );

    try {
      const drawer: HTMLElement = requireDrawer(mountedProbe.container);
      const backdrop: HTMLButtonElement = requireBackdrop(mountedProbe.container);

      expect(mountedProbe.container.textContent).toContain('Create group');

      await mountedProbe.rerender(createGroupsDetailResult());

      expect(requireDrawer(mountedProbe.container)).toBe(drawer);
      expect(requireBackdrop(mountedProbe.container)).toBe(backdrop);
      expect(mountedProbe.container.textContent).toContain('Operators');
    } finally {
      await mountedProbe.unmount();
    }
  });

  it('resets the groups create form when reopening the drawer', async (): Promise<void> => {
    const mountedProbe: MountedDrawerProbe<BrowserGroupsPageResult> = await mountDrawerProbe(
      createGroupsDrawerElement,
      createGroupsCreateResult(),
    );

    try {
      const nameInput: HTMLInputElement = requireGroupNameInput(mountedProbe.container);
      const descriptionTextarea: HTMLTextAreaElement = requireGroupDescriptionTextarea(mountedProbe.container);

      await updateTextControl(nameInput, 'Operators');
      await updateTextControl(descriptionTextarea, 'Handles production access');

      expect(requireGroupNameInput(mountedProbe.container).value).toBe('Operators');
      expect(requireGroupDescriptionTextarea(mountedProbe.container).value).toBe('Handles production access');

      await mountedProbe.rerender(createGroupsListResult());
      await mountedProbe.rerender(createGroupsCreateResult());

      expect(requireGroupNameInput(mountedProbe.container).value).toBe('');
      expect(requireGroupDescriptionTextarea(mountedProbe.container).value).toBe('');
    } finally {
      await mountedProbe.unmount();
    }
  });

  it('keeps the same users drawer shell between invite and detail modes', async (): Promise<void> => {
    const mountedProbe: MountedDrawerProbe<BrowserUsersPageResult> = await mountDrawerProbe(
      createUsersDrawerElement,
      createUsersCreateResult(),
    );

    try {
      const drawer: HTMLElement = requireDrawer(mountedProbe.container);
      const backdrop: HTMLButtonElement = requireBackdrop(mountedProbe.container);

      expect(mountedProbe.container.textContent).toContain('Invite user');

      await mountedProbe.rerender(createUsersDetailResult());

      expect(requireDrawer(mountedProbe.container)).toBe(drawer);
      expect(requireBackdrop(mountedProbe.container)).toBe(backdrop);
      expect(mountedProbe.container.textContent).toContain('viewer@example.com');
    } finally {
      await mountedProbe.unmount();
    }
  });

  it('keeps the same roles drawer shell between detail and edit modes', async (): Promise<void> => {
    const mountedProbe: MountedDrawerProbe<BrowserRolesPageResult> = await mountDrawerProbe(
      createRolesDrawerElement,
      createRolesDetailResult(),
    );

    try {
      const drawer: HTMLElement = requireDrawer(mountedProbe.container);
      const backdrop: HTMLButtonElement = requireBackdrop(mountedProbe.container);

      expect(mountedProbe.container.textContent).toContain('Effective permissions');

      await mountedProbe.rerender(createRolesEditResult());

      expect(requireDrawer(mountedProbe.container)).toBe(drawer);
      expect(requireBackdrop(mountedProbe.container)).toBe(backdrop);
      expect(mountedProbe.container.textContent).toContain('General role settings');
    } finally {
      await mountedProbe.unmount();
    }
  });
});

function createGroupsDrawerElement(data: BrowserGroupsPageResult): ReactElement {
  return React.createElement(GroupsDrawerProbe, { data });
}

function createUsersDrawerElement(data: BrowserUsersPageResult): ReactElement {
  return React.createElement(UserAccessPanel, {
    data,
    onNavigate: readNoopSoftNavigateHandler(),
    setData: readNoopUserAccessPanelSetter(),
  });
}

function createRolesDrawerElement(data: BrowserRolesPageResult): ReactElement {
  return React.createElement(RolesDrawerProbe, { data });
}

function GroupsDrawerProbe({ data }: Readonly<{ data: BrowserGroupsPageResult }>): ReactElement {
  const navigate: NavigateFunction = (): void => undefined;
  const state: GroupsPageState = useGroupsPageState(data, navigate);

  return React.createElement(GroupsPageContent, { state });
}

function RolesDrawerProbe({ data }: Readonly<{ data: BrowserRolesPageResult }>): ReactElement {
  const navigate: NavigateFunction = (): void => undefined;
  const state: RolesPageState = useRolesPageState(data, navigate);

  return React.createElement(RolesPageContent, { state });
}

async function mountDrawerProbe<TData>(
  renderElement: (data: TData) => ReactElement,
  initialData: TData,
): Promise<MountedDrawerProbe<TData>> {
  const container: HTMLDivElement = document.createElement('div');
  const root: Root = createRoot(container);
  document.body.append(container);

  const renderProbe: (nextData: TData) => Promise<void> = async (nextData: TData): Promise<void> => {
    await act(async (): Promise<void> => {
      root.render(renderElement(nextData));
      await flushEffects();
    });
  };

  await act(async (): Promise<void> => {
    root.render(renderElement(initialData));
    await flushEffects();
  });

  return new MountedDrawerProbeValue(container, root, renderProbe);
}

function requireDrawer(container: HTMLElement): HTMLElement {
  const drawer: HTMLElement | null = container.querySelector('aside');
  if (drawer === null) {
    throw new Error('Expected drawer aside.');
  }

  return drawer;
}

function requireBackdrop(container: HTMLElement): HTMLButtonElement {
  const backdrop: HTMLButtonElement | null = container.querySelector('button[aria-label="Close panel"]');
  if (backdrop === null) {
    throw new Error('Expected drawer backdrop button.');
  }

  return backdrop;
}

function requireGroupNameInput(container: HTMLElement): HTMLInputElement {
  const input: HTMLInputElement | null = container.querySelector(`${createGroupFormSelector} input`);
  if (input === null) {
    throw new Error('Expected group name input.');
  }

  return input;
}

function requireGroupDescriptionTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea: HTMLTextAreaElement | null = container.querySelector(`${createGroupFormSelector} textarea`);
  if (textarea === null) {
    throw new Error('Expected group description textarea.');
  }

  return textarea;
}

async function updateTextControl(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    const prototype: HTMLInputElement | HTMLTextAreaElement =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor: TypedPropertyDescriptor<string> | undefined = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set === undefined) {
      throw new Error('Expected value setter for editable field.');
    }

    descriptor.set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await flushEffects();
  });
}

function createGroupsCreateResult(): BrowserGroupsPageResult {
  return {
    assignments: [],
    currentOrganizationPermissions: createAccessManagementPermissions(),
    groups: [createGroup()],
    members: [],
    mode: 'create',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    roles: [createRoleListRow()],
    searchQuery: '',
    scopeProjects: [],
    selectedGroupId: null,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalGroups: 1,
    totalPages: 1,
  };
}

function createGroupsListResult(): BrowserGroupsPageResult {
  return {
    assignments: [],
    currentOrganizationPermissions: createAccessManagementPermissions(),
    groups: [createGroup()],
    members: [],
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    roles: [createRoleListRow()],
    searchQuery: '',
    scopeProjects: [],
    selectedGroupId: null,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalGroups: 1,
    totalPages: 1,
  };
}

function createGroupsDetailResult(): BrowserGroupsPageResult {
  const group: AccessGroupListRow = createGroup();

  return {
    assignments: [
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        id: 'asg_123',
        roleId: 'role_123',
        roleKind: 'custom',
        roleName: 'Viewer',
        scope: { scopeType: 'organization' },
        subject: {
          groupId: group.id,
          groupName: group.name,
          subjectType: 'group',
        },
      },
    ],
    currentOrganizationPermissions: createAccessManagementPermissions(),
    groups: [group],
    members: [],
    mode: 'detail',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    roles: [createRoleListRow()],
    searchQuery: '',
    scopeProjects: [],
    selectedGroupId: group.id,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalGroups: 1,
    totalPages: 1,
  };
}

function createUsersCreateResult(): BrowserUsersPageResult {
  return {
    availableGroups: [createGroup()],
    availableRoles: [],
    currentOrganizationPermissions: createUserManagementPermissions(),
    mode: 'create',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    scopeProjects: [],
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    selectedUserAccess: null,
    selectedUserEmail: null,
    showOrganizationSelector: false,
    sortBy: 'email',
    sortDirection: 'asc',
    totalPages: 1,
    totalUsers: 1,
    users: [createUser()],
  };
}

function createUsersDetailResult(): BrowserUsersPageResult {
  const user: BrowserUsersUser = createUser();
  const group: AccessGroupListRow = createGroup();
  const access: UserAccessDetail = {
    directAssignments: [],
    effectivePermissions: ['project.read'],
    groups: [
      {
        assignmentCount: group.assignmentCount,
        description: group.description,
        id: group.id,
        memberCount: group.memberCount,
        name: group.name,
      },
    ],
    user,
  };

  return {
    availableGroups: [group],
    availableRoles: [],
    currentOrganizationPermissions: createUserManagementPermissions(),
    mode: 'detail',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    scopeProjects: [],
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    selectedUserAccess: access,
    selectedUserEmail: user.email,
    showOrganizationSelector: false,
    sortBy: 'email',
    sortDirection: 'asc',
    totalPages: 1,
    totalUsers: 1,
    users: [user],
  };
}

function createRolesDetailResult(): BrowserRolesPageResult {
  const role: AccessRoleListRow = createRoleListRow();

  return {
    currentOrganizationPermissions: createAccessManagementPermissions(),
    mode: 'detail',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    permissionKeys: ['project.read'],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    role: createRoleSummary(role),
    roleId: role.id,
    roles: [role],
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalPages: 1,
    totalRoles: 1,
  };
}

function createRolesEditResult(): BrowserRolesPageResult {
  const role: AccessRoleListRow = createRoleListRow();

  return {
    currentOrganizationPermissions: createAccessManagementPermissions(),
    mode: 'edit',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    permissionKeys: ['project.read'],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    role: createRoleSummary(role),
    roleId: role.id,
    roles: [role],
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalPages: 1,
    totalRoles: 1,
  };
}

function createUser(): BrowserUsersUser {
  return {
    access: 'allowed',
    accessSummary: 'Limited view',
    directAccessScopeLabels: [],
    email: 'viewer@example.com',
    groupCount: 1,
    groupNames: ['Operators'],
    id: 'usr_123',
    roleNames: ['Viewer'],
    status: 'active',
    type: 'user',
  };
}

function createGroup(): AccessGroupListRow {
  return {
    assignedRoleNames: ['Viewer'],
    assignmentCount: 1,
    assignmentScopeLabels: ['Organization'],
    description: 'Operators who handle incidents',
    id: 'group_123',
    memberCount: 2,
    name: 'Operators',
  };
}

function createRoleListRow(): AccessRoleListRow {
  return {
    assignmentCount: 0,
    description: 'Read-only access',
    groupCount: 0,
    id: 'role_123',
    kind: 'custom',
    name: 'Viewer',
    permissionKeys: ['project.read'],
    principalCount: 0,
  };
}

function createRoleSummary(role: AccessRoleListRow): AccessRoleSummary {
  return {
    description: role.description,
    id: role.id,
    kind: role.kind,
    name: role.name,
    permissionKeys: role.permissionKeys,
  };
}

function createAccessManagementPermissions(): PermissionKey[] {
  return [
    'organization.group.manage',
    'organization.group.read',
    'organization.role.manage',
    'organization.role.read',
    'organization.user.invite',
    'organization.user.read',
  ];
}

function createUserManagementPermissions(): PermissionKey[] {
  return ['organization.user.invite', 'organization.user.read'];
}

function createOrganizationOption(): BrowserOrganizationOption {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}

function readNoopSoftNavigateHandler(): BrowserSoftNavigateHandler {
  return (): void => undefined;
}

function readNoopUserAccessPanelSetter(): UserAccessPanelSetter {
  return (): void => undefined;
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function configureReactActEnvironment(): void {
  const globalState: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
  globalState.IS_REACT_ACT_ENVIRONMENT = true;
}
