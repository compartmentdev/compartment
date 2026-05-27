// @vitest-environment jsdom

import * as React from 'react';
import { compartmentCsrfCookieName, compartmentCsrfHeaderName } from '@compartment/contracts/browser';
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createJsonResponse } from './browser-test.fixtures';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';
import type { BrowserSoftNavigateHandler } from '../src/browser-soft-navigation';
import { runProjectAction, type ProjectActionHandler } from '../src/features/projects/project-actions';
import { ProjectActionConfirmationDialog } from '../src/features/projects/project-row-actions-dropdown.confirmation';
import { ProjectsTable } from '../src/features/projects/projects-table';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type MockDropdownMenuItemPropValue = ReactNode;

interface MockDropdownMenuItemProps {
  asChild?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  [key: string]: MockDropdownMenuItemPropValue;
}

interface DocumentBodyContainer {
  body?: { innerHTML: string } | undefined;
}

vi.mock('../src/components/ui/dropdown-menu', async (importOriginal: () => Promise<object>): Promise<object> => {
  const actual: object = await importOriginal();
  const react: { createElement: typeof React.createElement } = await import('react');

  function DropdownMenuPassthrough({ children, ...props }: Readonly<MockDropdownMenuItemProps>): ReactElement {
    return react.createElement('div', props, children);
  }

  function DropdownMenuItem({
    asChild,
    children,
    disabled,
    ...props
  }: Readonly<MockDropdownMenuItemProps>): ReactElement {
    void asChild;
    return react.createElement(
      'div',
      {
        ...props,
        'data-disabled': disabled === true ? 'true' : undefined,
      },
      children,
    );
  }

  return {
    ...actual,
    DropdownMenuContent: DropdownMenuPassthrough,
    DropdownMenuItem,
  };
});

configureReactActEnvironment();

afterEach((): void => {
  clearDocumentBody();
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
    expect(html).toContain('Details');
    expect(html).toContain('aria-label="Open actions for billing"');
    expect(html).toContain('lucide-ellipsis');
    expect(html).toContain(
      'href="https://billing.apps.localhost" rel="noreferrer" target="_blank">Open production / web</a>',
    );
    expect(html).toContain('>Archive<');
    expect(html).not.toContain('Choose environment to open');
    expect(html.indexOf('>Details</a>')).toBeLessThan(html.indexOf('aria-label="Open actions for billing"'));
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

  it('builds exact-match confirmation copy for destructive project actions', async (): Promise<void> => {
    const archiveText: string = await renderProjectActionConfirmationDialogText('archive');
    const deleteText: string = await renderProjectActionConfirmationDialogText('delete');

    expect(archiveText).toContain('Type billing to archive this project.');
    expect(deleteText).toContain('Type billing to permanently remove this project.');
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

  it('keeps details and open dropdown actions for viewer projects rows', (): void => {
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
    expect(html).toContain('Details');
    expect(html).toContain('aria-label="Open actions for billing"');
    expect(html).toContain('lucide-ellipsis');
    expect(html).toContain('href="https://billing.apps.localhost"');
    expect(html).toContain('>Open production / web</a>');
    expect(html.indexOf('>Details</a>')).toBeLessThan(html.indexOf('aria-label="Open actions for billing"'));
    expect(html).not.toContain('Choose environment to open');
    expect(html).not.toContain('>Archive<');
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

    expect(html).toContain('Details');
    expect(html).not.toContain('href="https://billing.apps.localhost"');
    expect(html).not.toContain('No live route');
  });

  it('omits route badges from row actions when running projects have no live route', (): void => {
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

    expect(html).not.toContain('No live route');
    expect(html).not.toContain('href="https://billing.apps.localhost"');
  });

  it('renders a plain empty row for empty projects table results', (): void => {
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

    expect(html).toContain('No projects found.');
    expect(html).not.toContain('Deploy my first project');
    expect(html).not.toContain('href="/orgs/acme-dev/projects/create"');
  });

  it('keeps empty projects table rows free of onboarding actions for multi-org sessions', (): void => {
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

    expect(html).toContain('No projects found.');
    expect(html).not.toContain('Deploy my first project');
    expect(html).not.toContain('href="/orgs/acme-dev/projects/create"');
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

async function renderProjectActionConfirmationDialogText(action: 'archive' | 'delete'): Promise<string> {
  const container: HTMLDivElement = document.createElement('div');
  const root: Root = createRoot(container);
  document.body.append(container);

  await act(async (): Promise<void> => {
    root.render(
      React.createElement(ProjectActionConfirmationDialog, {
        action,
        isPending: false,
        onConfirm: (): void => undefined,
        onOpenChange: (): void => undefined,
        projectName: 'billing',
      }),
    );
    await Promise.resolve();
  });

  const dialogText: string = document.body.textContent;

  await act(async (): Promise<void> => {
    root.unmount();
    await Promise.resolve();
  });
  container.remove();

  return dialogText;
}

function clearDocumentBody(): void {
  const globalState: typeof globalThis & { document?: DocumentBodyContainer | undefined } = globalThis;
  const documentState: DocumentBodyContainer | undefined = globalState.document;
  if (hasDocumentBody(documentState)) {
    documentState.body.innerHTML = '';
  }
}

function configureReactActEnvironment(): void {
  const globalState: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
  globalState.IS_REACT_ACT_ENVIRONMENT = true;
}

function hasDocumentBody(value: DocumentBodyContainer | undefined): value is { body: { innerHTML: string } } {
  return value?.body !== undefined;
}
