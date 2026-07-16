// @vitest-environment jsdom

import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, useState, type ReactElement, type ReactNode } from 'react';
import {
  compartmentCsrfCookieName,
  compartmentCurrentOrganizationHeaderName,
  type AccessRoleListRow,
  type AccessRoleResponse,
  type DeployResponse,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createDeploymentHistoryPageResult, createDeploymentReadSummary } from './browser-deployment-history.fixtures';
import { type BrowserFetchCall, type FetchImplementation, readFetchPath } from './browser-client-pages.helpers';
import { createJsonResponse } from './browser-test.fixtures';
import { browserQueryClient } from '../src/lib/browser-query-client';
import { ConfirmationDialog } from '../src/components/confirmation-dialog';
import { AccessDrawerShell } from '../src/features/access/access-ui';
import type { DeploymentHistoryRollbackHandler } from '../src/features/deployment-history/deployment-history-actions';
import { DeploymentHistoryTableActions } from '../src/features/deployment-history/deployment-history-table-actions';
import { ProjectRowActionsDropdown } from '../src/features/projects/project-row-actions-dropdown';
import { RoleDetailDrawerContent, RoleDetailDrawerHeader } from '../src/features/roles/roles-page.detail-drawer';
import { buildRolesPageHref } from '../src/features/roles/roles-page.query';
import type { ProjectActionHandler } from '../src/features/projects/project-actions';
import type { RolesPageState } from '../src/features/roles/roles-page.state';
import type { BrowserDeploymentHistoryPageResult } from '../src/services/browser-deployment-history.service.types';
import type { BrowserProjectsPageResult, BrowserProjectSummary } from '../src/services/browser-projects.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';

type MockDropdownMenuPropValue = (() => void) | ReactNode;

type MockDropdownMenuItemProps = {
  asChild?: boolean;
  children?: ReactNode;
  className?: string | undefined;
  disabled?: boolean;
  onSelect?: (() => void) | undefined;
} & Record<string, MockDropdownMenuPropValue>;

interface MountedTestApp {
  container: HTMLDivElement;
  unmount: () => Promise<void>;
}

interface ProjectLifecycleDeploymentFixture {
  build: {
    env: [];
    include: [];
    packages: {
      build: [];
      runtime: [];
    };
    strategy: 'auto';
  };
  completedAt: null;
  createdAt: string;
  failureMessage: null;
  health: 'pending';
  id: string;
  isActive: boolean;
  label: null;
  operation: {
    completedAt: null;
    createdAt: string;
    id: string;
    status: 'running';
    targetId: string;
    targetType: 'deployment';
    type: 'deployment.create';
  };
  promotionStage: 'stopped';
  readiness: {
    path: '/healthz';
    timeoutMs: 30000;
    type: 'http';
  };
  rollbackAvailable: false;
  run: Record<string, never>;
  routeUrl: null;
  serviceName: string;
  status: 'stopped';
}

interface ProjectLifecycleEnvironmentFixture {
  createdAt: string;
  id: string;
  name: string;
  projectId: string;
  updatedAt: string;
}

interface ProjectLifecycleProjectFixture {
  archivedAt: null;
  createdAt: string;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: string;
}

interface ProjectLifecycleResponseFixture {
  action: 'start' | 'stop';
  deployments: ProjectLifecycleDeploymentFixture[];
  environment: ProjectLifecycleEnvironmentFixture;
  project: ProjectLifecycleProjectFixture;
  state: 'updating';
}

class MountedTestAppValue implements MountedTestApp {
  public constructor(
    public readonly container: HTMLDivElement,
    private readonly root: Root,
  ) {}

  public async unmount(): Promise<void> {
    await act(async (): Promise<void> => {
      this.root.unmount();
      await flushEffects();
    });
    this.container.remove();
  }
}

class TestRolesPageState implements RolesPageState {
  public data!: BrowserRolesPageResult;
  public description!: string;
  public drawerErrorMessage!: string | undefined;
  public name!: string;
  public onNavigate!: () => void;
  public selectedPermissions!: PermissionKey[];
  public setData!: () => void;
  public setDescription!: () => void;
  public setDrawerErrorMessage!: () => void;
  public setName!: () => void;
  public setSelectedPermissions!: () => void;
}

vi.mock('../src/components/ui/dropdown-menu', async (importOriginal: () => Promise<object>): Promise<object> => {
  const actual: object = await importOriginal();
  const react: { createElement: typeof React.createElement } = await import('react');

  function DropdownMenuPassthrough({ asChild, children, ...props }: Readonly<MockDropdownMenuItemProps>): ReactElement {
    void asChild;
    return react.createElement('div', props, children);
  }

  function DropdownMenuItem({
    asChild,
    children,
    disabled,
    onSelect,
    ...props
  }: Readonly<MockDropdownMenuItemProps>): ReactElement {
    if (asChild === true) {
      return react.createElement('div', props, children);
    }

    return react.createElement(
      'button',
      {
        ...props,
        disabled,
        onClick: (): void => {
          onSelect?.();
        },
        type: 'button',
      },
      children,
    );
  }

  return {
    ...actual,
    DropdownMenu: DropdownMenuPassthrough,
    DropdownMenuContent: DropdownMenuPassthrough,
    DropdownMenuItem,
    DropdownMenuTrigger: DropdownMenuPassthrough,
  };
});

configureReactActEnvironment();

afterEach((): void => {
  browserQueryClient.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('browser destructive confirmations', (): void => {
  it('requires an exact match and resets the typed confirmation dialog on reopen', async (): Promise<void> => {
    const mountedApp: MountedTestApp = await mountTestApp(React.createElement(ConfirmationDialogProbe));

    try {
      const dialog: HTMLElement = requireAlertDialog();
      const confirmButton: HTMLButtonElement = requireButton(dialog, 'Remove role');
      const cancelButton: HTMLButtonElement = requireButton(dialog, 'Cancel');

      expect(confirmButton.disabled).toBe(true);

      await updateInputValue(requireInputByLabel('Role name'), 'Viewer ');
      expect(confirmButton.disabled).toBe(true);

      await updateInputValue(requireInputByLabel('Role name'), 'Viewer');
      expect(requireButton(dialog, 'Remove role').disabled).toBe(false);

      await clickButton(cancelButton);
      await clickButton(requireButton(document.body, 'Reopen dialog'));

      expect(requireInputByLabel('Role name').value).toBe('');
      expect(requireButton(requireAlertDialog(), 'Remove role').disabled).toBe(true);
    } finally {
      await mountedApp.unmount();
    }
  });

  it('submits typed confirmations through the form submit path', async (): Promise<void> => {
    const onConfirm: Mock<() => void> = vi.fn<() => void>();
    const mountedApp: MountedTestApp = await mountTestApp(
      React.createElement(ConfirmationDialogActionProbe, { onConfirm }),
    );

    try {
      await updateInputValue(requireInputByLabel('Role name'), 'Viewer');
      requestDialogFormSubmit('Role name');
      await flushEffects();

      expect(onConfirm).toHaveBeenCalledTimes(1);
    } finally {
      await mountedApp.unmount();
    }
  });

  it('snapshots the destructive target while the dialog stays open', async (): Promise<void> => {
    const mountedApp: MountedTestApp = await mountTestApp(React.createElement(ConfirmationDialogSnapshotProbe));

    try {
      expect(requireAlertDialog().textContent).toContain('Type Viewer to remove this role.');

      await clickButton(requireButton(document.body, 'Rename target'));

      expect(requireAlertDialog().textContent).toContain('Type Viewer to remove this role.');
      expect(requireAlertDialog().textContent).not.toContain('Type Editor to remove this role.');

      await updateInputValue(requireInputByLabel('Role name'), 'Editor');
      expect(requireButton(requireAlertDialog(), 'Remove role').disabled).toBe(true);

      await updateInputValue(requireInputByLabel('Role name'), 'Viewer');
      expect(requireButton(requireAlertDialog(), 'Remove role').disabled).toBe(false);
    } finally {
      await mountedApp.unmount();
    }
  });

  it('keeps cancel disabled while a confirmation is pending', async (): Promise<void> => {
    const mountedApp: MountedTestApp = await mountTestApp(React.createElement(PendingConfirmationDialogProbe));

    try {
      expect(requireButton(requireAlertDialog(), 'Cancel').disabled).toBe(true);
      expect(requireButton(requireAlertDialog(), 'Remove role').disabled).toBe(true);
    } finally {
      await mountedApp.unmount();
    }
  });

  it('runs role detail deletes only after confirming the typed dialog', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse(createRoleResponse('role_123', 'Viewer'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const mountedApp: MountedTestApp = await mountWithBrowserQueryClient(
      React.createElement(RoleDetailDrawerProbe, {
        state: createRolesPageState(),
      }),
    );

    try {
      await clickButton(requireButton(mountedApp.container, 'Remove role'));
      expect(fetchMock).not.toHaveBeenCalled();

      await updateInputValue(requireInputByLabel('Role name'), 'wrong');
      expect(requireButton(requireAlertDialog(), 'Remove role').disabled).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();

      await updateInputValue(requireInputByLabel('Role name'), 'Viewer');
      await clickButton(requireButton(requireAlertDialog(), 'Remove role'));
      await waitForMutationFetch(fetchMock);

      const firstCall: BrowserFetchCall = fetchMock.mock.calls[0]!;
      expect(readFetchPath(firstCall[0])).toBe('/v1/roles/role_123');
      expect(new Headers(firstCall[1]?.headers).get(compartmentCurrentOrganizationHeaderName)).toBe('acme-dev');
    } finally {
      await mountedApp.unmount();
    }
  });

  it('runs project archive only after confirming the typed dialog', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse({
        project: {
          archivedAt: '2026-04-21T10:00:00.000Z',
          createdAt: '2026-04-21T08:00:00.000Z',
          id: 'prj_123',
          name: 'billing',
          organizationId: 'org_123',
          updatedAt: '2026-04-21T10:00:00.000Z',
        },
      });
    });
    const onProjectAction: Mock<ProjectActionHandler> = vi.fn<ProjectActionHandler>(async (): Promise<void> => {
      await Promise.resolve();
    });
    document.cookie = `${compartmentCsrfCookieName}=csrf-token`;
    vi.stubGlobal('fetch', fetchMock);

    const mountedApp: MountedTestApp = await mountWithBrowserQueryClient(
      React.createElement(ProjectRowActionsDropdown, {
        data: createProjectsPageResult(),
        onProjectAction,
        project: createProjectSummary(),
      }),
    );

    try {
      await clickButton(requireButton(mountedApp.container, 'Archive'));
      expect(fetchMock).not.toHaveBeenCalled();

      await updateInputValue(requireInputByLabel('Project name'), 'billing ');
      expect(requireButton(requireAlertDialog(), 'Archive project').disabled).toBe(true);

      await updateInputValue(requireInputByLabel('Project name'), 'billing');
      await clickButton(requireButton(requireAlertDialog(), 'Archive project'));
      await waitForMutationFetch(fetchMock);

      expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe('/v1/projects/billing/archive');
      expect(onProjectAction).toHaveBeenCalledWith('archive', 'billing');
    } finally {
      await mountedApp.unmount();
    }
  });

  it('runs project lifecycle start without opening a confirmation dialog', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return new Response(JSON.stringify(createProjectLifecycleResponse('start')), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    });
    const onProjectAction: Mock<ProjectActionHandler> = vi.fn<ProjectActionHandler>(async (): Promise<void> => {
      await Promise.resolve();
    });
    document.cookie = `${compartmentCsrfCookieName}=csrf-token`;
    vi.stubGlobal('fetch', fetchMock);

    const mountedApp: MountedTestApp = await mountWithBrowserQueryClient(
      React.createElement(ProjectRowActionsDropdown, {
        data: createProjectsPageResult({
          currentOrganizationPermissions: ['project.lifecycle.write'],
          projects: [
            createProjectSummary({ canManageArchive: false, lifecycleAction: 'start', lifecycleState: 'stopped' }),
          ],
        }),
        onProjectAction,
        project: createProjectSummary({ canManageArchive: false, lifecycleAction: 'start', lifecycleState: 'stopped' }),
      }),
    );

    try {
      await clickButton(requireButton(mountedApp.container, 'Start'));
      await waitForMutationFetch(fetchMock);

      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
      expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe('/v1/projects/billing/start');
      expect(onProjectAction).toHaveBeenCalledWith('start', 'billing');
    } finally {
      await mountedApp.unmount();
    }
  });

  it('disables every project action while a lifecycle mutation is pending', async (): Promise<void> => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchPromise: Promise<Response> = new Promise<Response>((resolve: (response: Response) => void): void => {
      resolveFetch = resolve;
    });
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (): Promise<Response> => await fetchPromise,
    );
    const onProjectAction: Mock<ProjectActionHandler> = vi.fn<ProjectActionHandler>(async (): Promise<void> => {
      await Promise.resolve();
    });
    const project: BrowserProjectSummary = createProjectSummary({
      canManageArchive: true,
      lifecycleAction: 'start',
      lifecycleState: 'stopped',
    });

    document.cookie = `${compartmentCsrfCookieName}=csrf-token`;
    vi.stubGlobal('fetch', fetchMock);

    const mountedApp: MountedTestApp = await mountWithBrowserQueryClient(
      React.createElement(ProjectRowActionsDropdown, {
        data: createProjectsPageResult({
          currentOrganizationPermissions: ['project.archive', 'project.lifecycle.write'],
          projects: [project],
        }),
        onProjectAction,
        project,
      }),
    );

    try {
      await clickButton(requireButton(mountedApp.container, 'Start'));
      await waitForMutationFetch(fetchMock);
      await flushEffects();

      expect(requireButton(mountedApp.container, 'Start').disabled).toBe(true);
      expect(requireButton(mountedApp.container, 'Archive').disabled).toBe(true);
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveFetch?.(
        new Response(JSON.stringify(createProjectLifecycleResponse('start')), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      );
      await flushEffects();
    } finally {
      await mountedApp.unmount();
    }
  });

  it('runs rollback after confirming the non-typed dialog', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(async (): Promise<Response> => {
      await Promise.resolve();
      return createJsonResponse(createDeployResponse('drn_rollback_new'));
    });
    const onRollback: Mock<DeploymentHistoryRollbackHandler> = vi.fn<DeploymentHistoryRollbackHandler>(
      async (): Promise<void> => {
        await Promise.resolve();
      },
    );
    document.cookie = `${compartmentCsrfCookieName}=csrf-token`;
    vi.stubGlobal('fetch', fetchMock);

    const data: BrowserDeploymentHistoryPageResult = createDeploymentHistoryPageResult({
      currentEnvironmentPermissions: ['deployment.rollback'],
      deployments: [
        createDeploymentReadSummary({
          deploymentRunId: 'drn_current',
          id: 'dep_current',
          isActive: true,
          rollbackAvailable: false,
        }),
        createDeploymentReadSummary({
          deploymentRunId: 'drn_rollback',
          id: 'dep_rollback',
          isActive: false,
          rollbackAvailable: true,
        }),
      ],
    });

    const mountedApp: MountedTestApp = await mountWithBrowserQueryClient(
      React.createElement(DeploymentHistoryTableActions, {
        data,
        onNavigate: (): void => undefined,
        onRollback,
        run: {
          completedAt: '2026-04-21T09:01:00.000Z',
          createdAt: '2026-04-21T09:00:00.000Z',
          deploymentCount: 1,
          deploymentRunId: 'drn_rollback',
          deployments: [data.deployments[1]!],
          failureMessage: null,
          label: 'release 41',
          status: 'succeeded',
        },
      }),
    );

    try {
      await clickButton(requireButton(mountedApp.container, 'Rollback'));
      const dialog: HTMLElement = requireAlertDialog();
      expect(dialog.textContent).toContain('Roll back billing production to deployment run drn_rollback?');

      await clickButton(requireButton(dialog, 'Rollback deployment'));
      await waitForMutationFetch(fetchMock);

      expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe('/v1/deployments/rollback');
      expect(onRollback).toHaveBeenCalledWith(expect.objectContaining({ deploymentRunId: 'drn_rollback_new' }));
    } finally {
      await mountedApp.unmount();
    }
  });
});

function RoleDetailDrawerProbe({ state }: Readonly<{ state: RolesPageState }>): ReactElement | null {
  const role: AccessRoleListRow | undefined = state.data.roles.find(
    (candidate: AccessRoleListRow): boolean => candidate.id === state.data.roleId,
  );
  if (role === undefined) {
    return null;
  }

  return React.createElement(AccessDrawerShell, {
    children: React.createElement(RoleDetailDrawerContent, { role, state }),
    closeHref: buildRolesPageHref(state.data),
    header: React.createElement(RoleDetailDrawerHeader, { role, state }),
    onNavigate: state.onNavigate,
    title: role.name,
  });
}

function ConfirmationDialogProbe(): ReactElement {
  const [isOpen, setIsOpen] = useState<boolean>(true);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'button',
      {
        onClick: (): void => {
          setIsOpen(true);
        },
        type: 'button',
      },
      'Reopen dialog',
    ),
    React.createElement(ConfirmationDialog, {
      confirmLabel: 'Remove role',
      description: 'Type Viewer to remove this role.',
      expectedValue: 'Viewer',
      inputLabel: 'Role name',
      inputPlaceholder: 'Viewer',
      onConfirm: (): void => undefined,
      onOpenChange: setIsOpen,
      open: isOpen,
      title: 'Remove role',
    }),
  );
}

function ConfirmationDialogActionProbe({ onConfirm }: Readonly<{ onConfirm: () => void }>): ReactElement {
  return React.createElement(ConfirmationDialog, {
    confirmLabel: 'Remove role',
    description: 'Type Viewer to remove this role.',
    expectedValue: 'Viewer',
    inputLabel: 'Role name',
    inputPlaceholder: 'Viewer',
    onConfirm,
    onOpenChange: (): void => undefined,
    open: true,
    title: 'Remove role',
  });
}

function ConfirmationDialogSnapshotProbe(): ReactElement {
  const [target, setTarget] = useState<string>('Viewer');

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'button',
      {
        onClick: (): void => {
          setTarget('Editor');
        },
        type: 'button',
      },
      'Rename target',
    ),
    React.createElement(ConfirmationDialog, {
      confirmLabel: 'Remove role',
      description: `Type ${target} to remove this role.`,
      expectedValue: target,
      inputLabel: 'Role name',
      inputPlaceholder: target,
      onConfirm: (): void => undefined,
      onOpenChange: (): void => undefined,
      open: true,
      title: 'Remove role',
    }),
  );
}

function PendingConfirmationDialogProbe(): ReactElement {
  return React.createElement(ConfirmationDialog, {
    confirmLabel: 'Remove role',
    description: 'Type Viewer to remove this role.',
    expectedValue: 'Viewer',
    inputLabel: 'Role name',
    inputPlaceholder: 'Viewer',
    isPending: true,
    onConfirm: (): void => undefined,
    onOpenChange: (): void => undefined,
    open: true,
    title: 'Remove role',
  });
}

async function mountWithBrowserQueryClient(element: ReactElement): Promise<MountedTestApp> {
  return await mountTestApp(React.createElement(QueryClientProvider, { client: browserQueryClient }, element));
}

async function mountTestApp(element: ReactElement): Promise<MountedTestApp> {
  const container: HTMLDivElement = document.createElement('div');
  const root: Root = createRoot(container);
  document.body.append(container);

  await act(async (): Promise<void> => {
    root.render(element);
    await flushEffects();
  });

  return new MountedTestAppValue(container, root);
}

async function clickButton(button: HTMLButtonElement): Promise<void> {
  await act(async (): Promise<void> => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushEffects();
  });
}

async function updateInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    setInputElementValue(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flushEffects();
  });
}

function setInputElementValue(input: HTMLInputElement, value: string): void {
  const valueDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  );
  if (valueDescriptor?.set === undefined) {
    throw new Error('Expected input value setter.');
  }

  valueDescriptor.set.call(input, value);
}

function requireAlertDialog(): HTMLElement {
  const dialog: HTMLElement | null = document.body.querySelector('[role="alertdialog"]');
  if (dialog === null) {
    throw new Error('Expected alert dialog.');
  }

  return dialog;
}

function requireButton(container: ParentNode, label: string): HTMLButtonElement {
  const buttons: HTMLButtonElement[] = [...container.querySelectorAll('button')];
  const button: HTMLButtonElement | undefined = buttons.find((candidate: HTMLButtonElement): boolean =>
    candidate.textContent.includes(label),
  );
  if (button === undefined) {
    throw new Error(`Expected button with label ${label}.`);
  }

  return button;
}

function requireInputByLabel(labelText: string): HTMLInputElement {
  const labels: HTMLLabelElement[] = [...document.body.querySelectorAll('label')];
  const label: HTMLLabelElement | undefined = labels.find((candidate: HTMLLabelElement): boolean =>
    candidate.textContent.includes(labelText),
  );
  if (label === undefined || label.htmlFor === '') {
    throw new Error(`Expected label ${labelText}.`);
  }

  const input: HTMLInputElement | null = document.getElementById(label.htmlFor) as HTMLInputElement | null;
  if (input === null) {
    throw new Error(`Expected input for label ${labelText}.`);
  }

  return input;
}

function requestDialogFormSubmit(labelText: string): void {
  const form: HTMLFormElement | null = requireInputByLabel(labelText).form;
  if (form === null) {
    throw new Error(`Expected form for label ${labelText}.`);
  }

  form.requestSubmit();
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForMutationFetch(fetchMock: Mock<FetchImplementation>): Promise<void> {
  for (let index: number = 0; index < 20; index += 1) {
    if (fetchMock.mock.calls.length > 0) {
      return;
    }

    await flushEffects();
  }

  throw new Error('Expected mutation fetch call.');
}

function createRolesPageState(): RolesPageState {
  return Object.assign(new TestRolesPageState(), {
    data: createRolesPageResult({
      mode: 'detail',
      role: createRoleResponse('role_123', 'Viewer').role,
      roleId: 'role_123',
      roles: [createRoleListRow('role_123', 'Viewer')],
    }),
    description: '',
    drawerErrorMessage: undefined,
    name: '',
    onNavigate: (): void => undefined,
    selectedPermissions: [],
    setData: (): void => undefined,
    setDescription: (): void => undefined,
    setDrawerErrorMessage: (): void => undefined,
    setName: (): void => undefined,
    setSelectedPermissions: (): void => undefined,
  });
}

function createRolesPageResult(overrides: Partial<BrowserRolesPageResult> = {}): BrowserRolesPageResult {
  const roles: AccessRoleListRow[] = overrides.roles ?? [createRoleListRow('role_loader', 'Loader role')];
  return {
    currentOrganizationPermissions: createAccessManagementPermissions(),
    mode: 'list',
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    permissionKeys: ['project.read'],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    role: null,
    roleId: null,
    roles,
    searchQuery: '',
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'name',
    sortDirection: 'asc',
    totalPages: 1,
    totalRoles: roles.length,
    ...overrides,
  };
}

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
        routeUrl: 'https://billing.apps.localhost',
        serviceName: 'web',
      },
    ],
    routeUrl: 'https://billing.apps.localhost',
    serviceCount: 1,
    status: 'healthy',
    updatedAt: '2026-04-21T09:00:00.000Z',
    ...overrides,
  };
}

function createAccessManagementPermissions(): PermissionKey[] {
  return [
    'organization.user.read',
    'organization.user.invite',
    'organization.user.block',
    'organization.user.remove',
    'organization.user.credentials.reset',
    'organization.group.read',
    'organization.group.manage',
    'organization.role.read',
    'organization.role.manage',
  ];
}

function createRoleResponse(id: string, name: string): AccessRoleResponse {
  return {
    role: {
      description: null,
      id,
      kind: 'custom',
      name,
      permissionKeys: ['project.read'],
    },
  };
}

function createDeployResponse(deploymentRunId: string): DeployResponse {
  return {
    deploymentRunId,
    deployments: [
      {
        build: {
          env: [],
          include: [],
          packages: {
            build: [],
            runtime: [],
          },
          strategy: 'auto',
        },
        completedAt: null,
        createdAt: '2026-04-21T09:00:00.000Z',
        failureMessage: null,
        health: 'pending',
        id: 'dep_rollback_new',
        isActive: false,
        label: null,
        operation: {
          completedAt: null,
          createdAt: '2026-04-21T09:00:00.000Z',
          id: 'op_rollback_new',
          status: 'running',
          targetId: 'dep_rollback_new',
          targetType: 'deployment',
          type: 'deployment.create',
        },
        promotionStage: 'building',
        readiness: {
          path: '/healthz',
          timeoutMs: 30000,
          type: 'http',
        },
        rollbackAvailable: false,
        run: {},
        routeUrl: null,
        serviceName: 'web',
        status: 'running',
      },
    ],
    environment: {
      createdAt: '2026-04-21T09:00:00.000Z',
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: '2026-04-21T09:00:00.000Z',
    },
    project: {
      archivedAt: null,
      createdAt: '2026-04-21T09:00:00.000Z',
      id: 'prj_123',
      name: 'billing',
      organizationId: 'org_123',
      updatedAt: '2026-04-21T09:00:00.000Z',
    },
    resources: [],
  };
}

function createProjectLifecycleResponse(action: 'start' | 'stop'): ProjectLifecycleResponseFixture {
  return {
    action,
    deployments: [
      {
        build: {
          env: [],
          include: [],
          packages: {
            build: [],
            runtime: [],
          },
          strategy: 'auto',
        },
        completedAt: null,
        createdAt: '2026-04-21T09:00:00.000Z',
        failureMessage: null,
        health: 'pending',
        id: 'dep_start_new',
        isActive: false,
        label: null,
        operation: {
          completedAt: null,
          createdAt: '2026-04-21T09:00:00.000Z',
          id: 'op_start_new',
          status: 'running',
          targetId: 'dep_start_new',
          targetType: 'deployment',
          type: 'deployment.create',
        },
        promotionStage: 'stopped',
        readiness: {
          path: '/healthz',
          timeoutMs: 30000,
          type: 'http',
        },
        rollbackAvailable: false,
        run: {},
        routeUrl: null,
        serviceName: 'web',
        status: 'stopped',
      },
    ],
    environment: {
      createdAt: '2026-04-21T09:00:00.000Z',
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: '2026-04-21T09:00:00.000Z',
    },
    project: {
      archivedAt: null,
      createdAt: '2026-04-21T09:00:00.000Z',
      id: 'prj_123',
      name: 'billing',
      organizationId: 'org_123',
      updatedAt: '2026-04-21T09:00:00.000Z',
    },
    state: 'updating',
  };
}

function createRoleListRow(id: string, name: string): AccessRoleListRow {
  return {
    assignmentCount: 0,
    description: null,
    groupCount: 0,
    id,
    kind: 'custom',
    name,
    permissionKeys: ['project.read'],
    principalCount: 0,
  };
}

function configureReactActEnvironment(): void {
  const globalState: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
  globalState.IS_REACT_ACT_ENVIRONMENT = true;
}
