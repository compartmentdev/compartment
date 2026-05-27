import {
  buildDeploymentReadRunGroups,
  type DeployResponse,
  type DeploymentReadRunGroup,
  type DeploymentRunLogsResponse,
} from '@compartment/contracts/browser';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  BrowserDeploymentDetailsPageResult,
  BrowserDeploymentHistoryPageResult,
} from '../src/services/browser-deployment-history.service.types';
import { BrowserApiError } from '../src/lib/browser-api';
import { browserQueryClient } from '../src/lib/browser-query-client';
import {
  loadDeploymentDetailsPageData,
  refreshDeploymentDetailsPageDataForUrl,
} from '../src/features/deployment-history/deployment-details-loader';
import { DeploymentDetailsView } from '../src/features/deployment-history/deployment-details-view';
import { loadDeploymentHistoryPageData } from '../src/features/deployment-history/deployment-history-loader';
import { DeploymentHistoryView } from '../src/features/deployment-history/deployment-history-view';
import { DeploymentHistoryTable } from '../src/features/deployment-history/deployment-history-table';
import { DeploymentHistoryTableActions } from '../src/features/deployment-history/deployment-history-table-actions';
import type { DeploymentHistoryRollbackHandler } from '../src/features/deployment-history/deployment-history-actions';
import { createDeploymentHistoryRollbackHandler } from '../src/features/deployment-history/deployment-history-view.actions';
import {
  createDeploymentDetailsPageResult,
  createDeploymentHistoryPageResult,
  createDeploymentReadSummary,
  createDeploymentRunLogsResponse,
} from './browser-deployment-history.fixtures';
import {
  createDeploymentListResponse,
  createLoaderArgs,
  createOrganizationListResponse,
  createProjectCountResponse,
  createWhoamiResponse,
  noopBrowserNavigate,
  noopDeploymentHistoryRollback,
  readFetchPath,
  requireRedirectResponse,
  type BrowserDeploymentDetailsPageLoadResult,
  type BrowserDeploymentHistoryPageLoadResult,
  type BrowserFetchCall,
  type FetchImplementation,
} from './browser-client-pages.helpers';
import { createJsonResponse } from './browser-test.fixtures';

type MockDropdownMenuItemPropValue = ReactNode;

interface MockDropdownMenuItemProps {
  asChild?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  [key: string]: MockDropdownMenuItemPropValue;
}

vi.mock('../src/components/ui/dropdown-menu', async (importOriginal: () => Promise<object>): Promise<object> => {
  const actual: object = await importOriginal();
  const react: { createElement: typeof createElement } = await import('react');

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

const browserProjectCountPath: string =
  '/v1/projects?archiveState=active&detail=overview&orderBy=updatedAt&page=1&perPage=1&sort=desc';
const browserDeploymentRunLogsPath: string =
  '/v1/deployments/runs/logs?projectName=billing&selector=run&deploymentRunId=drn_123';

function readFirstDeploymentRun(data: BrowserDeploymentHistoryPageResult): DeploymentReadRunGroup {
  const run: DeploymentReadRunGroup | undefined = buildDeploymentReadRunGroups(data.deployments)[0];
  if (run === undefined) {
    throw new Error('Expected deployment run.');
  }

  return run;
}

function renderRollbackMenuItem(data: BrowserDeploymentHistoryPageResult): string {
  return renderToStaticMarkup(
    createElement(DeploymentHistoryTableActions, {
      data,
      onNavigate: noopBrowserNavigate,
      onRollback: noopDeploymentHistoryRollback,
      run: readFirstDeploymentRun(data),
    }),
  );
}

describe('browser deployment pages', (): void => {
  afterEach((): void => {
    browserQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it('loads deployment history with the selected organization context', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === '/v1/whoami?environmentName=production&projectName=billing') {
          return createJsonResponse(createWhoamiResponse(['deployment.rollback']));
        }
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === '/v1/deployments?environmentName=production&limit=50&projectName=billing') {
          return createJsonResponse(createDeploymentListResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const request: Request = new Request(
      'http://console.localhost/orgs/acme-dev/projects/billing/deployments?environmentName=production',
    );
    const result: BrowserDeploymentHistoryPageResult = await loadDeploymentHistoryPageData(
      createLoaderArgs(request, { projectName: 'billing' }),
    );

    expect(result.deployments[0]?.deploymentRunId).toBe('drn_123');
    expect(result.currentEnvironmentPermissions).toEqual(['deployment.rollback']);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      '/v1/whoami?environmentName=production&projectName=billing',
      '/v1/deployments?environmentName=production&limit=50&projectName=billing',
    ]);
  });

  it('redirects unscoped deployment history back to project overview', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentHistoryPageLoadResult = await loadDeploymentHistoryPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/projects/billing/deployments'), {
        projectName: 'billing',
      }),
    );

    const redirectResponse: Response = requireRedirectResponse(result);
    expect(redirectResponse.headers.get('Location')).toBe(
      '/orgs/acme-dev/projects/billing?error=project_overview_environment_required',
    );
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('preserves multi-org context when redirecting unscoped deployment history', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === '/v1/orgs') {
          return createJsonResponse({
            organizations: [
              { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
              { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
            ],
          });
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentHistoryPageLoadResult = await loadDeploymentHistoryPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/projects/billing/deployments'), {
        projectName: 'billing',
      }),
    );

    const redirectResponse: Response = requireRedirectResponse(result);
    expect(redirectResponse.headers.get('Location')).toBe(
      '/orgs/acme-dev/projects/billing?error=project_overview_environment_required',
    );
  });

  it('loads deployment details from the run logs surface', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === browserDeploymentRunLogsPath) {
          return createJsonResponse(createDeploymentRunLogsResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentDetailsPageResult = await loadDeploymentDetailsPageData(
      createLoaderArgs(
        new Request(
          'http://console.localhost/orgs/acme-dev/projects/billing/deployments/drn_123?environmentName=production',
        ),
        {
          deploymentRunId: 'drn_123',
          projectName: 'billing',
        },
      ),
    );

    expect(result.backHref).toBe('/orgs/acme-dev/projects/billing/deployments?environmentName=production');
    expect(result.deployment.id).toBe('drn_123');
    expect(result.deploymentRunId).toBe('drn_123');
    expect(result.deployments[0]?.deploymentRunId).toBe('drn_123');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      browserDeploymentRunLogsPath,
    ]);
  });

  it('keeps deployment details back links scoped for multi-org sessions', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === '/v1/orgs') {
          return createJsonResponse({
            organizations: [
              { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
              { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
            ],
          });
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === browserDeploymentRunLogsPath) {
          return createJsonResponse(createDeploymentRunLogsResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentDetailsPageResult = await loadDeploymentDetailsPageData(
      createLoaderArgs(
        new Request(
          'http://console.localhost/orgs/acme-dev/projects/billing/deployments/drn_123?environmentName=production',
        ),
        {
          deploymentRunId: 'drn_123',
          projectName: 'billing',
        },
      ),
    );

    expect(result.backHref).toBe('/orgs/acme-dev/projects/billing/deployments?environmentName=production');
    expect(result.showOrganizationSelector).toBe(true);
  });

  it('loads deployment details without an explicit environment query', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === browserDeploymentRunLogsPath) {
          return createJsonResponse(createDeploymentRunLogsResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentDetailsPageResult = await loadDeploymentDetailsPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/projects/billing/deployments/drn_123'), {
        deploymentRunId: 'drn_123',
        projectName: 'billing',
      }),
    );

    expect(result.environmentName).toBe('production');
    expect(result.backHref).toBe('/orgs/acme-dev/projects/billing/deployments?environmentName=production');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      browserDeploymentRunLogsPath,
    ]);
  });

  it('refreshes deployment details from the existing browser console context only', async (): Promise<void> => {
    const refreshedRunLogsResponse: DeploymentRunLogsResponse = {
      ...createDeploymentRunLogsResponse(),
      deployment: {
        ...createDeploymentRunLogsResponse().deployment,
        status: 'running',
      },
      lines: [
        {
          deploymentId: 'dep_123',
          level: 'info',
          message: 'build step 12/18',
          serviceName: 'web',
          stepKey: 'building_image',
          stream: 'stdout',
          timestamp: '2026-04-21T09:01:45.000Z',
        },
      ],
      steps: [
        ...createDeploymentRunLogsResponse().steps,
        {
          completedAt: null,
          createdAt: '2026-04-21T09:01:10.000Z',
          deploymentId: 'dep_123',
          message: 'Image build running.',
          serviceName: 'web',
          status: 'running',
          stepKey: 'building_image',
        },
      ],
    };
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === browserDeploymentRunLogsPath) {
          return createJsonResponse(refreshedRunLogsResponse);
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentDetailsPageResult = await refreshDeploymentDetailsPageDataForUrl(
      createDeploymentDetailsPageResult({
        deployment: {
          ...createDeploymentDetailsPageResult().deployment,
          status: 'running',
        },
      }),
    );

    expect(result.deployment.status).toBe('running');
    expect(result.lines).toEqual(refreshedRunLogsResponse.lines);
    expect(result.steps).toEqual(refreshedRunLogsResponse.steps);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      browserDeploymentRunLogsPath,
    ]);
  });

  it('redirects unavailable deployment details routes back to the history list', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === browserDeploymentRunLogsPath) {
          throw new BrowserApiError(404, 'Missing deployment run logs.');
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentDetailsPageLoadResult = await loadDeploymentDetailsPageData(
      createLoaderArgs(
        new Request(
          'http://console.localhost/orgs/acme-dev/projects/billing/deployments/drn_123?environmentName=production',
        ),
        {
          deploymentRunId: 'drn_123',
          projectName: 'billing',
        },
      ),
    );

    const response: Response = requireRedirectResponse(result);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      '/orgs/acme-dev/projects/billing/deployments?environmentName=production&error=deployment_details_unavailable',
    );
  });

  it('keeps unavailable deployment details redirects scoped for multi-org sessions', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === '/v1/orgs') {
          return createJsonResponse({
            organizations: [
              { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
              { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
            ],
          });
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === browserDeploymentRunLogsPath) {
          throw new BrowserApiError(404, 'Missing deployment run logs.');
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentDetailsPageLoadResult = await loadDeploymentDetailsPageData(
      createLoaderArgs(
        new Request(
          'http://console.localhost/orgs/acme-dev/projects/billing/deployments/drn_123?environmentName=production',
        ),
        {
          deploymentRunId: 'drn_123',
          projectName: 'billing',
        },
      ),
    );

    const response: Response = requireRedirectResponse(result);
    expect(response.headers.get('Location')).toBe(
      '/orgs/acme-dev/projects/billing/deployments?environmentName=production&error=deployment_details_unavailable',
    );
  });

  it('keeps unavailable organization deployment details redirects on the requested organization path', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentDetailsPageLoadResult = await loadDeploymentDetailsPageData(
      createLoaderArgs(
        new Request(
          'http://console.localhost/orgs/hidden-org/projects/billing/deployments/drn_123?environmentName=production',
        ),
        {
          deploymentRunId: 'drn_123',
          projectName: 'billing',
        },
      ),
    );

    const response: Response = requireRedirectResponse(result);
    expect(response.headers.get('Location')).toBe(
      '/orgs/hidden-org/projects/billing/deployments?environmentName=production',
    );
  });

  it('renders deployment history empty state, actions menu, and clamped failures', (): void => {
    const emptyHtml: string = renderToStaticMarkup(
      createElement(DeploymentHistoryTable, {
        data: createDeploymentHistoryPageResult({
          deployments: [],
        }),
        onNavigate: noopBrowserNavigate,
        onRollback: noopDeploymentHistoryRollback,
      }),
    );
    expect(emptyHtml).toContain('No deployments found.');
    const historyHtml: string = renderToStaticMarkup(
      createElement(DeploymentHistoryTable, {
        data: createDeploymentHistoryPageResult(),
        onNavigate: noopBrowserNavigate,
        onRollback: noopDeploymentHistoryRollback,
      }),
    );
    expect(historyHtml).toContain('release 42');
    expect(historyHtml).toContain('drn_123');
    expect(historyHtml).toContain('web');
    expect(historyHtml).toContain('dep_123');
    expect(historyHtml).toContain('aria-label="Open actions for release 42"');
    expect(historyHtml).toContain('lucide-ellipsis');
    expect(historyHtml).toContain('aria-haspopup="menu"');
    expect(historyHtml).toContain('<colgroup>');
    expect(historyHtml).toContain('min-w-[1008px]');
    expect(historyHtml).toContain('table-fixed');
    expect(historyHtml).toContain('w-[12rem]');
    expect(historyHtml).toContain('w-[7.25rem]');
    expect(historyHtml).toContain('w-[8rem]');
    expect(historyHtml).toContain('text-[12px] leading-5');
    expect(historyHtml).toContain('block whitespace-nowrap');
    expect(historyHtml).toContain('w-[5.75rem]');
    expect(historyHtml).toContain('w-[7.5rem]');
    expect(historyHtml).toContain('break-all');
    expect(historyHtml).not.toContain('>Rollback<');
    const multiOrgHistoryHtml: string = renderToStaticMarkup(
      createElement(DeploymentHistoryTable, {
        data: createDeploymentHistoryPageResult({
          organizations: [
            { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
            { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
          ],
          showOrganizationSelector: true,
        }),
        onNavigate: noopBrowserNavigate,
        onRollback: noopDeploymentHistoryRollback,
      }),
    );
    expect(multiOrgHistoryHtml).toContain(
      'href="/orgs/acme-dev/projects/billing/deployments/drn_123?environmentName=production"',
    );
    const groupedHistoryHtml: string = renderToStaticMarkup(
      createElement(DeploymentHistoryTable, {
        data: createDeploymentHistoryPageResult({
          deployments: [
            createDeploymentReadSummary({
              deploymentRunId: 'drn_grouped',
              id: 'dep_web',
              serviceName: 'web',
            }),
            createDeploymentReadSummary({
              deploymentRunId: 'drn_grouped',
              id: 'dep_backoffice',
              isActive: false,
              serviceName: 'backoffice',
            }),
          ],
        }),
        onNavigate: noopBrowserNavigate,
        onRollback: noopDeploymentHistoryRollback,
      }),
    );
    expect(groupedHistoryHtml).toContain('drn_grouped');
    expect(groupedHistoryHtml).toContain('2 services');
    expect(groupedHistoryHtml).toContain('dep_web');
    expect(groupedHistoryHtml).toContain('dep_backoffice');
    expect(groupedHistoryHtml).toContain('backoffice');
    expect(groupedHistoryHtml).not.toContain('Active route');
    expect(groupedHistoryHtml).not.toContain('Inactive route');
    expect(groupedHistoryHtml.match(/Succeeded/g)?.length).toBe(1);
    const mixedHistoryData: BrowserDeploymentHistoryPageResult = createDeploymentHistoryPageResult({
      currentOrganizationPermissions: ['deployment.rollback'],
      deployments: [
        createDeploymentReadSummary({
          deploymentRunId: 'drn_mixed',
          id: 'dep_web_mixed',
          serviceName: 'web',
          status: 'succeeded',
        }),
        createDeploymentReadSummary({
          deploymentRunId: 'drn_mixed',
          failureMessage: 'Boot failed.',
          id: 'dep_worker_mixed',
          isActive: false,
          operation: {
            completedAt: '2026-04-21T09:02:00.000Z',
            createdAt: '2026-04-21T09:00:00.000Z',
            status: 'failed',
            type: 'deployment.create',
          },
          serviceName: 'worker',
          status: 'failed',
        }),
      ],
    });
    const mixedHistoryHtml: string = renderToStaticMarkup(
      createElement(DeploymentHistoryTable, {
        data: mixedHistoryData,
        onNavigate: noopBrowserNavigate,
        onRollback: noopDeploymentHistoryRollback,
      }),
    );
    expect(mixedHistoryHtml).toContain('dep_web_mixed');
    expect(mixedHistoryHtml).toContain('dep_worker_mixed');
    expect(mixedHistoryHtml).toContain('worker');
    expect(mixedHistoryHtml).toContain('Failed');
    expect(mixedHistoryHtml).toContain('Succeeded');
    expect(mixedHistoryHtml).toContain('Current active run');
    const cleanedHistoryViewHtml: string = renderToStaticMarkup(
      createElement(DeploymentHistoryView, {
        data: createDeploymentHistoryPageResult({
          currentOrganizationPermissions: ['deployment.rollback'],
          deployments: [
            createDeploymentReadSummary({
              deploymentRunId: 'drn_view',
              id: 'dep_view',
              isActive: false,
            }),
          ],
        }),
        onNavigate: noopBrowserNavigate,
      }),
    );
    expect(cleanedHistoryViewHtml).toContain('drn_view');
    expect(cleanedHistoryViewHtml).toContain('aria-label="Breadcrumb"');
    expect(cleanedHistoryViewHtml).toContain('href="/orgs/acme-dev/projects"');
    expect(cleanedHistoryViewHtml).toContain('href="/orgs/acme-dev/projects/billing?environmentName=production"');
    expect(cleanedHistoryViewHtml).toContain('aria-current="page"');
    expect(cleanedHistoryViewHtml).toContain('title="Deployments">Deployments</span>');
    expect(cleanedHistoryViewHtml).toContain('lucide-box');
    expect(cleanedHistoryViewHtml).toContain('aria-label="Environment"');
    expect(cleanedHistoryViewHtml).toContain('>Production</span>');
    expect(cleanedHistoryViewHtml).not.toContain(
      'Deployment runs, release history, and rollback status for production.',
    );
    expect(cleanedHistoryViewHtml).toContain('aria-label="Open actions for release 42"');
    expect(cleanedHistoryViewHtml).toContain('lucide-ellipsis');
    expect(cleanedHistoryViewHtml).toContain('Rollback unavailable');
    expect(cleanedHistoryViewHtml).not.toContain('deployment_details_unavailable');
    const failedHtml: string = renderToStaticMarkup(
      createElement(DeploymentHistoryTable, {
        data: createDeploymentHistoryPageResult({
          currentOrganizationPermissions: ['deployment.rollback'],
          deployments: [
            {
              ...createDeploymentHistoryPageResult().deployments[0]!,
              failureMessage: 'line 1\nline 2\nline 3',
              status: 'failed',
            },
          ],
        }),
        onNavigate: noopBrowserNavigate,
        onRollback: noopDeploymentHistoryRollback,
      }),
    );
    expect(failedHtml).toContain('[-webkit-line-clamp:2]');
    expect(failedHtml).toContain('break-words');
  });

  it('renders rollback menu item availability and disabled reasons', (): void => {
    const enabledData: BrowserDeploymentHistoryPageResult = createDeploymentHistoryPageResult({
      currentEnvironmentPermissions: ['deployment.rollback'],
      deployments: [
        createDeploymentReadSummary({
          deploymentRunId: 'drn_rollback',
          id: 'dep_rollback',
          isActive: false,
        }),
      ],
    });
    const enabledHtml: string = renderRollbackMenuItem(enabledData);
    expect(enabledHtml).toContain('>Rollback<');
    expect(enabledHtml).not.toContain('Current active run');

    const activeData: BrowserDeploymentHistoryPageResult = createDeploymentHistoryPageResult({
      currentEnvironmentPermissions: ['deployment.rollback'],
    });
    const activeHtml: string = renderRollbackMenuItem(activeData);
    expect(activeHtml).toContain('>Rollback<');
    expect(activeHtml).toContain('Current active run');

    const hiddenData: BrowserDeploymentHistoryPageResult = createDeploymentHistoryPageResult({
      currentEnvironmentPermissions: [],
    });
    const hiddenHtml: string = renderRollbackMenuItem(hiddenData);
    expect(hiddenHtml).toContain('>Details<');
    expect(hiddenHtml).not.toContain('>Rollback<');
  });

  it('preserves multi-org context after rollback success navigation', (): void => {
    const onNavigate: Mock<(href: string) => void> = vi.fn<(href: string) => void>();
    const setActionErrorMessage: Mock<(value: string | undefined) => void> =
      vi.fn<(value: string | undefined) => void>();
    const onRollback: DeploymentHistoryRollbackHandler = createDeploymentHistoryRollbackHandler(
      createDeploymentHistoryPageResult({
        organizations: [
          { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
          { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
        ],
        showOrganizationSelector: true,
      }),
      onNavigate,
      setActionErrorMessage,
    );

    void onRollback({ deploymentRunId: 'drn_rollback_new' } as DeployResponse);

    expect(setActionErrorMessage).toHaveBeenCalledWith(undefined);
    expect(onNavigate).toHaveBeenCalledWith(
      '/orgs/acme-dev/projects/billing/deployments/drn_rollback_new?environmentName=production',
    );
  });

  it('renders deployment run details timeline and plain log lines', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(DeploymentDetailsView, {
        data: createDeploymentDetailsPageResult({
          deployment: {
            ...createDeploymentRunLogsResponse().deployment,
            id: 'drn_2c8c4d620ec34092a0f42102b6e57e8b',
          },
          deployments: [
            createDeploymentReadSummary({
              deploymentRunId: 'drn_2c8c4d620ec34092a0f42102b6e57e8b',
              id: 'dep_205b56db93b840bcb1851c7d00bd4cd6',
              serviceName: 'backoffice',
            }),
            createDeploymentReadSummary({
              deploymentRunId: 'drn_2c8c4d620ec34092a0f42102b6e57e8b',
              id: 'dep_d8b8dea28548415490480cacbb40a884',
              routeUrl: 'https://multi-service.apps.localhost',
              serviceName: 'web',
            }),
          ],
          deploymentRunId: 'drn_2c8c4d620ec34092a0f42102b6e57e8b',
        }),
        onNavigate: noopBrowserNavigate,
      }),
    );
    expect(html).toContain('Deployment run details');
    expect(html).toContain('lucide-file-box');
    expect(html).toContain('aria-label="Environment"');
    expect(html).toContain('>Production</span>');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/orgs/acme-dev/projects"');
    expect(html).toContain('href="/orgs/acme-dev/projects/billing?environmentName=production"');
    expect(html).toContain('href="/orgs/acme-dev/projects/billing/deployments?environmentName=production"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('title="Run details">Run details</span>');
    expect(html).toContain('production');
    expect(html).not.toContain('Reuse');
    expect(html).toContain('Run ID');
    expect(html).toContain('drn_2c8c4d620ec34092a0f42102b6e57e8b');
    expect(html).toContain('dep_205b56db93b840bcb1851c7d00bd4cd6');
    expect(html).toContain('block whitespace-nowrap');
    expect(html).toContain('Preparing source');
    expect(html).toContain('2026-04-21T09:01:30.000Z [web] stdout boot complete');
  });
});
