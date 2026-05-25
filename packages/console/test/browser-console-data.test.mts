import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createMemoryRouter, RouterProvider, type DataRouter } from 'react-router';
import { BrowserConsoleShell } from '../src/components/browser-console-header';
import { loadBrowserConsoleContext, loadSidebarProjectCount } from '../src/features/console/console-data';
import {
  BrowserConsoleShellRouteBoundary,
  browserConsoleShellRouteId,
  loadBrowserConsoleShellRouteData,
  type BrowserConsoleShellData,
} from '../src/features/console/console-shell-route';
import { browserQueryClient } from '../src/lib/browser-query-client';
import {
  createOrganizationListResponse,
  createProjectCountResponse,
  createLoaderArgs,
  createWhoamiResponse,
  readFetchPath,
  type BrowserFetchCall,
  type FetchImplementation,
} from './browser-client-pages.helpers';
import { createJsonResponse } from './browser-test.fixtures';

const browserProjectCountPath: string =
  '/v1/projects?archiveState=active&detail=overview&orderBy=updatedAt&page=1&perPage=1&sort=desc';

describe('browser console data', (): void => {
  afterEach((): void => {
    browserQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it('reuses cached organization context data across repeated loads', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }

        throw new Error(`Unexpected request: ${path}`);
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const url: URL = new URL('http://console.localhost:9080/orgs/acme-dev/projects');

    await expect(loadBrowserConsoleContext(url)).resolves.toMatchObject({
      principalEmail: 'admin@example.com',
      selectedOrganizationSlug: 'acme-dev',
    });
    await expect(loadBrowserConsoleContext(url)).resolves.toMatchObject({
      principalEmail: 'admin@example.com',
      selectedOrganizationSlug: 'acme-dev',
    });

    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('cancels console context loads through the route abort signal', async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    const abortError: Error = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        controller.abort();
        if (init?.signal?.aborted === true) {
          throw abortError;
        }

        throw new Error('Console context request was not cancelled.');
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const url: URL = new URL('http://console.localhost:9080/orgs/acme-dev/projects');

    await expect(loadBrowserConsoleContext(url, { signal: controller.signal })).rejects.toBe(abortError);
  });

  it('propagates aborted sidebar project count requests', async (): Promise<void> => {
    const abortError: Error = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockRejectedValue(abortError);
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadSidebarProjectCount('acme-dev')).rejects.toBe(abortError);
  });

  it('falls back to zero for non-abort sidebar project count failures', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockRejectedValue(new Error('Project count unavailable.'));
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadSidebarProjectCount('acme-dev')).resolves.toBe(0);
  });

  it('loads and caches parent console shell data including the sidebar project count', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }

        throw new Error(`Unexpected request: ${path}`);
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const request: Request = new Request('http://console.localhost:9080/orgs/acme-dev/users');

    await expect(loadBrowserConsoleShellRouteData(createLoaderArgs(request))).resolves.toMatchObject({
      principalEmail: 'admin@example.com',
      projectCount: 1,
      selectedOrganizationSlug: 'acme-dev',
    });
    await expect(loadBrowserConsoleShellRouteData(createLoaderArgs(request))).resolves.toMatchObject({
      principalEmail: 'admin@example.com',
      projectCount: 1,
      selectedOrganizationSlug: 'acme-dev',
    });

    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      browserProjectCountPath,
    ]);
  });

  it('provides parent shell loader data to nested console shell routes', async (): Promise<void> => {
    const router: DataRouter = createMemoryRouter(
      [
        {
          Component: BrowserConsoleShellRouteBoundary,
          id: browserConsoleShellRouteId,
          loader: async (): Promise<BrowserConsoleShellData> =>
            await Promise.resolve({
              currentOrganizationPermissions: ['organization.user.read'],
              organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
              organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
              principalEmail: 'admin@example.com',
              projectCount: 3,
              selectedOrganizationSlug: 'acme-dev',
              showOrganizationSelector: false,
            }),
          children: [
            {
              Component: (): ReactElement =>
                createElement(BrowserConsoleShell, {
                  children: createElement('div', null, 'content'),
                  page: 'projects',
                }),
              path: '/',
            },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    const html: string = renderToStaticMarkup(createElement(RouterProvider, { router }));

    expect(html).toContain('admin@example.com');
    expect(html).toContain('href="/orgs/acme-dev/projects"');
    expect(html).toContain('content');
  });

  it('skips the sidebar project-count fetch when the shell route has no selected organization', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse({
            organizations: [
              { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
              { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
            ],
          });
        }
        if (path === '/v1/whoami') {
          return createJsonResponse({
            currentOrganization: null,
            currentOrganizationPermissions: [],
            principal: { email: 'admin@example.com', id: 'prn_123', type: 'user' },
          });
        }

        throw new Error(`Unexpected request: ${path}`);
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserConsoleShellData = await loadBrowserConsoleShellRouteData(
      createLoaderArgs(new Request('http://console.localhost:9080/')),
    );

    expect(result.projectCount).toBeUndefined();
    expect(result.selectedOrganizationSlug).toBeNull();
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });
});
