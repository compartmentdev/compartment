// @vitest-environment jsdom

import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactElement } from 'react';
import { compartmentCsrfCookieName, type DeployResponse } from '@compartment/contracts/browser';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createDeploymentHistoryPageResult, createDeploymentReadSummary } from './browser-deployment-history.fixtures';
import { type FetchImplementation } from './browser-client-pages.helpers';
import { createJsonResponse } from './browser-test.fixtures';
import { browserQueryClient } from '../src/lib/browser-query-client';
import type { DeploymentHistoryRollbackHandler } from '../src/features/deployment-history/deployment-history-actions';
import { DeploymentHistoryTableActions } from '../src/features/deployment-history/deployment-history-table-actions';
import { ProjectRowActionsDropdown } from '../src/features/projects/project-row-actions-dropdown';
import type { ProjectActionHandler } from '../src/features/projects/project-actions';
import type { BrowserDeploymentHistoryPageResult } from '../src/services/browser-deployment-history.service.types';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';

interface MountedTestApp {
  container: HTMLDivElement;
  unmount: () => Promise<void>;
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
afterEach((): void => {
  browserQueryClient.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('browser destructive confirmations with real radix menus', (): void => {
  it('keeps the project archive dialog open after the menu closes', async (): Promise<void> => {
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
      await openActionsMenu('Open actions for billing');
      await clickMenuItem('Archive');

      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(requireAlertDialog().textContent).toContain('Type billing to archive this project.');
    } finally {
      await mountedApp.unmount();
    }
  });

  it('keeps the rollback dialog open after the menu closes', async (): Promise<void> => {
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
      await openActionsMenu('Open actions for release 41');
      await clickMenuItem('Rollback');

      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(requireAlertDialog().textContent).toContain(
        'Roll back billing production to deployment run drn_rollback?',
      );
    } finally {
      await mountedApp.unmount();
    }
  });
});

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

async function openActionsMenu(ariaLabel: string): Promise<void> {
  await clickElement(requireButtonByAriaLabel(ariaLabel));
}

async function clickMenuItem(label: string): Promise<void> {
  await clickElement(requireMenuItem(label));
}

async function clickElement(element: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await flushEffects();
  });
}

function requireAlertDialog(): HTMLElement {
  const dialog: HTMLElement | null = document.body.querySelector('[role="alertdialog"]');
  if (dialog === null) {
    throw new Error('Expected alert dialog.');
  }

  return dialog;
}

function requireButtonByAriaLabel(label: string): HTMLButtonElement {
  const button: HTMLButtonElement | undefined = [...document.body.querySelectorAll('button')].find(
    (candidate: HTMLButtonElement): boolean => candidate.getAttribute('aria-label') === label,
  );
  if (button === undefined) {
    throw new Error(`Expected button with aria-label ${label}.`);
  }

  return button;
}

function requireMenuItem(label: string): HTMLElement {
  const menuItem: HTMLElement | undefined = [...document.body.querySelectorAll('[role="menuitem"]')].find(
    (candidate: Element): boolean => candidate.textContent.includes(label),
  ) as HTMLElement | undefined;
  if (menuItem === undefined) {
    throw new Error(`Expected menu item ${label}.`);
  }

  return menuItem;
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createProjectsPageResult(overrides?: Partial<BrowserProjectsPageResult>): BrowserProjectsPageResult {
  return {
    archiveState: 'active',
    currentOrganizationPermissions: ['project.archive', 'project.lifecycle.write'],
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
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
        containerId: null,
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
        run: {
          restart: {
            policy: 'on-failure',
          },
        },
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

function configureReactActEnvironment(): void {
  const globalState: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
  globalState.IS_REACT_ACT_ENVIRONMENT = true;
}

configureReactActEnvironment();
