import {
  compartmentConsoleSsoFailedLoginErrorMessage as invalidSsoLoginBusinessErrorMessage,
  type ActivateStateResponse,
  type LoginStateResponse,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LoaderFunctionArgs } from 'react-router';
import type { BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';
import type { BrowserProjectOverviewPageResult } from '../src/services/browser-project-overview.service.types';
import { BrowserConsoleSidebar } from '../src/components/browser-console-sidebar';
import { requestBrowserApi } from '../src/lib/browser-api';
import { browserQueryClient } from '../src/lib/browser-query-client';
import {
  createAuthErrorState,
  readNextAuthErrorState,
  type AuthErrorState,
} from '../src/features/auth/auth-error-state';
import { loadActivatePage } from '../src/features/auth/activate-page';
import {
  canInviteBrowserUsers,
  canReadBrowserGroups,
  canReadBrowserRoles,
  canReadBrowserUsers,
} from '../src/features/console/console-access';
import { loadLoginPage } from '../src/features/auth/login-page';
import { LoginView } from '../src/features/auth/login-view';
import { ProjectArchiveStateSwitch } from '../src/features/projects/project-archive-state-switch';
import { loadProjectOverviewPageData } from '../src/features/projects/project-overview-loader';
import { loadProjectsPageDataForUrl } from '../src/features/projects/projects-loader';
import { loadAuditEventsPageData } from '../src/features/audit-events/audit-events-loader';
import { loadGroupsPageData } from '../src/features/groups/groups-loader';
import { loadDeploymentHistoryPageData } from '../src/features/deployment-history/deployment-history-loader';
import { loadRolesPageData } from '../src/features/roles/roles-loader';
import { loadUsersPageData } from '../src/features/users/users-loader';
import { UsersView } from '../src/features/users/users-view';
import { readLoginSuccessRedirectTo } from '../src/features/auth/login-success-redirect';
import {
  createConsoleAdminPermissions,
  createLoaderArgs,
  createOrganizationListResponse,
  createProjectCountResponse,
  createWhoamiResponse,
  readFetchPath,
  requireRedirectResponse,
  type BrowserApiErrorExpectation,
  type FetchImplementation,
  type LoginPageLoadResult,
  type BrowserFetchCall,
  type BrowserDeploymentHistoryPageLoadResult,
  type BrowserGroupsPageLoadResult,
  type BrowserRolesPageLoadResult,
  type BrowserUsersPageLoadResult,
} from './browser-client-pages.helpers';
import type { BrowserAuditEventsPageResult } from '../src/services/browser-audit-events.service.types';
import { createJsonResponse } from './browser-test.fixtures';

const browserProjectCountPath: string =
  '/v1/projects?archiveState=active&detail=overview&orderBy=updatedAt&page=1&perPage=1&sort=desc';
const browserAllProjectCountPath: string =
  '/v1/projects?archiveState=all&detail=overview&orderBy=updatedAt&page=1&perPage=1&sort=desc';

function createBrowserProjectsPageResult(overrides?: Partial<BrowserProjectsPageResult>): BrowserProjectsPageResult {
  return {
    archiveState: 'active',
    currentOrganizationPermissions: ['project.archive'],
    organizationContext: {
      kind: 'selected',
      selectedOrganizationSlug: 'acme-dev',
    },
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

function createMultiOrgUnselectedFetchMock(): Mock<FetchImplementation> {
  return vi.fn<FetchImplementation>().mockImplementation(async (input: string | URL | Request): Promise<Response> => {
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

    throw new Error(`Unexpected browser API request: ${path}`);
  });
}

function createMultiOrgFetchMock(currentOrganizationPermissions: string[]): Mock<FetchImplementation> {
  return vi.fn<FetchImplementation>().mockImplementation(async (input: string | URL | Request): Promise<Response> => {
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
      return createJsonResponse(createWhoamiResponse(currentOrganizationPermissions));
    }

    throw new Error(`Unexpected browser API request: ${path}`);
  });
}

describe('browser client pages', (): void => {
  afterEach((): void => {
    browserQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it('reads browser API error messages from the standard API error envelope', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            code: 'forbidden',
            message: 'Organization admin access is required.',
          },
        },
        403,
      ),
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const expectedError: BrowserApiErrorExpectation = {
      message: 'Organization admin access is required.',
      name: 'BrowserApiError',
      status: 403,
    };

    await expect(requestBrowserApi('/v1/users', z.object({}))).rejects.toMatchObject(expectedError);
  });

  it('passes a no-auto-redirect signal to login state after SSO failures', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockResolvedValueOnce(
      createJsonResponse({
        flowTarget: {
          host: 'billing.apps.localhost',
          path: '/dashboard',
          state: 'flow',
        },
        localPasswordEnabled: false,
        ssoOptions: [
          {
            buttonText: 'Continue with Google',
            loginUrl: '/login/sso?provider=sop_123',
            providerId: 'sop_123',
          },
        ],
        view: 'methods',
      }),
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: LoginPageLoadResult = await loadLoginPage(
      createLoaderArgs(
        new Request(
          'http://console.localhost/login?error=sso_failed&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
        ),
      ),
    );

    expect(result.errorMessage).toBe(invalidSsoLoginBusinessErrorMessage);
    expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe(
      '/v1/auth/login-state?host=billing.apps.localhost&path=%2Fdashboard&state=flow&autoRedirect=false',
    );
  });

  it('loads activation state responses that fall back to SSO login', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockResolvedValueOnce(
      createJsonResponse({
        email: 'viewer@example.com',
        flowTarget: {
          host: 'billing.apps.localhost',
          path: '/dashboard',
          state: 'flow',
        },
        hasToken: true,
        unavailableReason: 'local_password_disabled',
      }),
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: ActivateStateResponse = await loadActivatePage(
      createLoaderArgs(
        new Request(
          'http://console.localhost/activate?email=viewer%40example.com&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
        ),
      ),
    );

    expect(result.unavailableReason).toBe('local_password_disabled');
    expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe(
      '/v1/auth/activate-state?email=viewer%40example.com&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
    );
  });

  it('keeps start-onboarding as a browser login success redirect only', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockResolvedValueOnce(
      createJsonResponse({
        flowTarget: null,
        localPasswordEnabled: true,
        ssoOptions: [],
        view: 'methods',
      }),
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: LoginPageLoadResult = await loadLoginPage(
      createLoaderArgs(new Request('http://console.localhost/login?start-onboarding&email=admin@example.com')),
    );

    expect(result.initialEmail).toBe('admin@example.com');
    expect(result.successRedirectTo).toBe('/onboarding');
    expect(readFetchPath(fetchMock.mock.calls[0]![0])).toBe('/v1/auth/login-state');
  });

  it('reads create-project login success redirects from the browser query string', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockResolvedValueOnce(
      createJsonResponse({
        flowTarget: null,
        localPasswordEnabled: true,
        ssoOptions: [],
        view: 'methods',
      }),
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: LoginPageLoadResult = await loadLoginPage(
      createLoaderArgs(
        new Request(
          'http://console.localhost/login?successRedirectTo=%2Forgs%2Facme-dev%2Fprojects%2Fcreate%3Fmethod%3Dcli%26step%3Dsource',
        ),
      ),
    );

    expect(result.successRedirectTo).toBe('/orgs/acme-dev/projects/create?method=cli&step=source');
  });

  it('preserves start-onboarding for SSO login links', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(LoginView, {
        initialData: {
          flowTarget: null,
          localPasswordEnabled: false,
          ssoOptions: [
            {
              buttonText: 'Continue with SSO',
              loginUrl: '/login/sso?provider=sop_123',
              providerId: 'sop_123',
            },
          ],
          view: 'methods',
        } satisfies LoginStateResponse,
        successRedirectTo: '/onboarding',
      }),
    );

    expect(markup).toContain('href="/login/sso?provider=sop_123&amp;start-onboarding=true"');
  });

  it('preserves create-project redirects for SSO login links', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(LoginView, {
        initialData: {
          flowTarget: null,
          localPasswordEnabled: false,
          ssoOptions: [
            {
              buttonText: 'Continue with SSO',
              loginUrl: '/login/sso?provider=sop_123',
              providerId: 'sop_123',
            },
          ],
          view: 'methods',
        } satisfies LoginStateResponse,
        successRedirectTo: '/projects/create',
      }),
    );

    expect(markup).toContain('href="/login/sso?provider=sop_123&amp;successRedirectTo=%2Fprojects%2Fcreate"');
  });

  it('renders bare login discovery as an email-only first step', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(LoginView, {
        initialData: {
          flowTarget: null,
          view: 'email_entry',
        } satisfies LoginStateResponse,
      }),
    );

    expect(markup).toContain('name="email"');
    expect(markup).not.toContain('name="organizationSlug"');
    expect(markup).not.toContain('Organization slug');
  });

  it('preserves start-onboarding for selected-organization project redirects', (): void => {
    expect(readLoginSuccessRedirectTo('/orgs/acme-dev/projects', '/onboarding')).toBe('/orgs/acme-dev/onboarding');
  });

  it('keeps start-onboarding on the root chooser when organization context is still missing', (): void => {
    expect(readLoginSuccessRedirectTo('/', '/onboarding')).toBe('/?start-onboarding=true');
  });

  it('preserves create-project redirects for selected-organization project redirects', (): void => {
    expect(readLoginSuccessRedirectTo('/orgs/acme-dev/projects', '/projects/create')).toBe(
      '/orgs/acme-dev/projects/create',
    );
  });

  it('keeps exact organization-scoped create-project redirects', (): void => {
    expect(
      readLoginSuccessRedirectTo('/orgs/acme-dev/projects', '/orgs/acme-dev/projects/create?method=cli&step=source'),
    ).toBe('/orgs/acme-dev/projects/create?method=cli&step=source');
  });

  it('treats repeated auth errors as fresh alert events', (): void => {
    const firstState: AuthErrorState = createAuthErrorState('Invalid email or password.');
    const secondState: AuthErrorState = readNextAuthErrorState(firstState, 'Invalid email or password.');

    expect(secondState).toEqual({
      id: firstState.id + 1,
      message: 'Invalid email or password.',
    });
  });

  it('does not prefill the password login email field from the current browser session', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(LoginView, {
        initialData: {
          flowTarget: null,
          localPasswordEnabled: true,
          principalEmail: 'admin@example.com',
          ssoOptions: [],
          view: 'methods',
        } satisfies LoginStateResponse,
      }),
    );

    expect(markup).toContain('name="email"');
    expect(markup).not.toContain('value="admin@example.com"');
  });

  it('prefills the password login email field from an explicit login link hint', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(LoginView, {
        initialData: {
          flowTarget: null,
          localPasswordEnabled: true,
          ssoOptions: [],
          view: 'methods',
        } satisfies LoginStateResponse,
        initialEmail: 'admin@example.com',
      }),
    );

    expect(markup).toContain('name="email"');
    expect(markup).toContain('value="admin@example.com"');
  });

  it('maps unauthorized users loader API responses to the console redirect', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse({
            organizations: [
              {
                id: 'org_123',
                name: 'Acme Dev',
                slug: 'acme-dev',
              },
            ],
          });
        }
        if (path === '/v1/whoami') {
          return createJsonResponse({
            currentOrganization: {
              id: 'org_123',
              name: 'Acme Dev',
              slug: 'acme-dev',
            },
            currentOrganizationPermissions: ['project.read'],
            principal: {
              email: 'viewer@example.com',
              id: 'prn_456',
              type: 'user',
            },
          });
        }

        return createJsonResponse(
          {
            error: {
              code: 'forbidden',
              message: 'Organization admin access is required.',
            },
          },
          403,
        );
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserUsersPageLoadResult = await loadUsersPageData({
      request: new Request('http://console.localhost/orgs/acme-dev/users'),
    } as LoaderFunctionArgs);

    const redirectResponse: Response = requireRedirectResponse(result);
    expect(redirectResponse).toBeInstanceOf(Response);
    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get('Location')).toBe('/orgs/acme-dev/projects?notice=users_admin_required');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map((call: [input: string | URL | Request, init?: RequestInit | undefined]): string =>
        readFetchPath(call[0]),
      ),
    ).toEqual(['/v1/orgs', '/v1/whoami']);
  });

  it('keeps users pages working when the sidebar project count fails', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse(createConsoleAdminPermissions()));
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(
            {
              error: {
                code: 'unauthorized',
                message: 'Session expired.',
              },
            },
            401,
          );
        }
        if (path.startsWith('/v1/users?')) {
          return createJsonResponse({
            pagination: {
              page: 1,
              perPage: 10,
              totalItems: 1,
              totalPages: 1,
            },
            users: [],
          });
        }
        if (path === '/v1/roles?detail=options') {
          return createJsonResponse({ detail: 'options', roles: [] });
        }
        if (path === '/v1/groups?detail=options') {
          return createJsonResponse({ detail: 'options', groups: [] });
        }
        if (path === '/v1/assignments/scope-options') {
          return createJsonResponse({ projects: [] });
        }

        throw new Error(`Unexpected fetch path: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const request: Request = new Request('http://console.localhost/orgs/acme-dev/users');
    const result: BrowserUsersPageLoadResult = await loadUsersPageData(createLoaderArgs(request));
    if (result instanceof Response) throw new Error('Expected users page result.');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      '/v1/users?orderBy=email&sort=asc&page=1&perPage=10',
      '/v1/roles?detail=options',
      '/v1/groups?detail=options',
      '/v1/assignments/scope-options',
    ]);
  });

  it('does not render users actions before multi-org organization context is selected', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
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

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserUsersPageLoadResult = await loadUsersPageData(
      createLoaderArgs(new Request('http://console.localhost/users')),
    );

    if (result instanceof Response) throw new Error('Expected users page result.');
    expect(result.organizationContext.kind).toBe('organization_required');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);

    const markup: string = renderToStaticMarkup(
      createElement(UsersView, {
        data: result,
        onNavigate: (): void => undefined,
        onUserAction: async (): Promise<void> => await Promise.resolve(),
        setData: (): void => undefined,
      }),
    );
    expect(markup).toContain('Choose an organization');
    expect(markup).not.toContain('Invite user');
    expect(markup).not.toContain('Search users');
  });

  it('does not load audit events before multi-org organization context is selected', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgUnselectedFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserAuditEventsPageResult = await loadAuditEventsPageData(
      createLoaderArgs(new Request('http://console.localhost/audit')),
    );

    expect(result.organizationContext.kind).toBe('organization_required');
    expect(result.events).toEqual([]);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('does not load groups before multi-org organization context is selected', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgUnselectedFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserGroupsPageLoadResult = await loadGroupsPageData(
      createLoaderArgs(new Request('http://console.localhost/groups?mode=create')),
    );

    if (result instanceof Response) throw new Error('Expected groups page result.');
    expect(result.organizationContext.kind).toBe('organization_required');
    expect(result.groups).toEqual([]);
    expect(result.mode).toBe('list');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('does not load roles before multi-org organization context is selected', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgUnselectedFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserRolesPageLoadResult = await loadRolesPageData(
      createLoaderArgs(new Request('http://console.localhost/roles?mode=create')),
    );

    if (result instanceof Response) throw new Error('Expected roles page result.');
    expect(result.organizationContext.kind).toBe('organization_required');
    expect(result.roles).toEqual([]);
    expect(result.mode).toBe('list');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('does not load deployment history before multi-org organization context is selected', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgUnselectedFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserDeploymentHistoryPageLoadResult = await loadDeploymentHistoryPageData(
      createLoaderArgs(
        new Request('http://console.localhost/projects/billing/deployments?environmentName=production'),
        {
          projectName: 'billing',
        },
      ),
    );

    if (result instanceof Response) throw new Error('Expected deployment history page result.');
    expect(result.organizationContext.kind).toBe('organization_required');
    expect(result.deployments).toEqual([]);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
  });

  it('preserves selected organization when user permission redirects leave multi-org pages', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgFetchMock([]);
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserUsersPageLoadResult = await loadUsersPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/users')),
    );

    const redirectResponse: Response = requireRedirectResponse(result);
    expect(redirectResponse.headers.get('Location')).toBe('/orgs/acme-dev/projects?notice=users_admin_required');
  });

  it('preserves selected organization when audit permission redirects leave multi-org pages', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createMultiOrgFetchMock([]);
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserAuditEventsPageResult = await loadAuditEventsPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/audit')),
    );

    const redirectResponse: Response = requireRedirectResponse(result);
    expect(redirectResponse.headers.get('Location')).toBe('/orgs/acme-dev/projects?notice=audit_read_required');
  });

  it('loads read-only users without role-scope options and ignores create mode', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse(['organization.user.read']));
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path.startsWith('/v1/users?')) {
          return createJsonResponse({
            pagination: {
              page: 1,
              perPage: 10,
              totalItems: 0,
              totalPages: 1,
            },
            users: [],
          });
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserUsersPageLoadResult = await loadUsersPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/users?mode=create')),
    );

    if (result instanceof Response) throw new Error('Expected users page result.');
    expect(result.mode).toBe('list');
    expect(result.availableGroups).toEqual([]);
    expect(result.availableRoles).toEqual([]);
    expect(result.scopeProjects).toEqual([]);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      '/v1/users?orderBy=email&sort=asc&page=1&perPage=10',
    ]);
  });

  it('loads invite-only users directly into the create flow without reading users', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse(['organization.user.invite']));
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserUsersPageLoadResult = await loadUsersPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/users')),
    );

    if (result instanceof Response) throw new Error('Expected users page result.');
    expect(result.mode).toBe('create');
    expect(result.users).toEqual([]);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
    ]);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).not.toContain(
      '/v1/users?orderBy=email&sort=asc&page=1&perPage=10',
    );
  });

  it('loads read-only groups without role-scope endpoints and ignores create mode', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse(['organization.group.read']));
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === '/v1/groups?detail=list&orderBy=name&page=1&perPage=10&sort=asc') {
          return createJsonResponse({
            detail: 'list',
            groups: [],
            pagination: {
              page: 1,
              perPage: 10,
              totalItems: 0,
              totalPages: 1,
            },
          });
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserGroupsPageLoadResult = await loadGroupsPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/groups?mode=create')),
    );

    if (result instanceof Response) throw new Error('Expected groups page result.');
    expect(result.mode).toBe('list');
    expect(result.assignments).toEqual([]);
    expect(result.projectCount).toBe(1);
    expect(result.roles).toEqual([]);
    expect(result.scopeProjects).toEqual([]);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      browserProjectCountPath,
      '/v1/groups?detail=list&orderBy=name&page=1&perPage=10&sort=asc',
    ]);
  });

  it('loads read-only roles and ignores create mode', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse(['organization.role.read']));
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === '/v1/roles?detail=list&orderBy=name&page=1&perPage=10&sort=asc') {
          return createJsonResponse({
            detail: 'list',
            pagination: {
              page: 1,
              perPage: 10,
              totalItems: 1,
              totalPages: 1,
            },
            roles: [
              {
                assignmentCount: 0,
                description: null,
                groupCount: 0,
                id: 'role_123',
                kind: 'custom',
                name: 'Viewer',
                permissionKeys: ['project.read'],
                principalCount: 0,
              },
            ],
          });
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserRolesPageLoadResult = await loadRolesPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/roles?mode=create')),
    );

    if (result instanceof Response) throw new Error('Expected roles page result.');
    expect(result.mode).toBe('list');
    expect(result.projectCount).toBe(1);
    expect(result.roles).toHaveLength(1);
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      browserProjectCountPath,
      '/v1/roles?detail=list&orderBy=name&page=1&perPage=10&sort=asc',
    ]);
  });

  it('leaves archived project requests on the API-owned scoped surface', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse({
            organizations: [
              {
                id: 'org_123',
                name: 'Acme Dev',
                slug: 'acme-dev',
              },
            ],
          });
        }
        if (path === '/v1/whoami') {
          return createJsonResponse({
            currentOrganization: {
              id: 'org_123',
              name: 'Acme Dev',
              slug: 'acme-dev',
            },
            currentOrganizationPermissions: ['project.read'],
            principal: {
              email: 'viewer@example.com',
              id: 'prn_456',
              type: 'user',
            },
          });
        }
        if (path.startsWith('/v1/projects?')) {
          return createJsonResponse({
            detail: 'overview',
            pagination: {
              page: 1,
              perPage: 10,
              totalItems: 1,
              totalPages: 1,
            },
            projects: [
              {
                archivedAt: '2026-04-21T10:00:00.000Z',
                canManageArchive: false,
                canReadDeployments: false,
                canManageLifecycle: false,
                createdAt: '2026-04-20T08:00:00.000Z',
                environmentName: 'production',
                id: 'proj_123',
                lastDeploymentCreatedAt: '2026-04-21T08:00:00.000Z',
                lifecycleAction: null,
                lifecycleDisabledReason: null,
                lifecycleState: 'running',
                name: 'billing',
                organizationId: 'org_123',
                openTargets: [
                  {
                    environmentName: 'production',
                    routeUrl: 'https://billing.apps.localhost',
                    serviceName: 'web',
                  },
                ],
                routeUrl: 'https://billing.apps.localhost',
                serviceCount: 2,
                status: 'archived',
                updatedAt: '2026-04-21T09:00:00.000Z',
              },
            ],
          });
        }

        throw new Error(`Unexpected fetch path: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectsPageResult = await loadProjectsPageDataForUrl(
      new URL('http://console.localhost/orgs/acme-dev/projects?archiveState=archived'),
    );

    expect(result.archiveState).toBe('archived');
    expect(fetchMock.mock.calls).toHaveLength(4);
    expect(readFetchPath(fetchMock.mock.calls[2]![0])).toBe(browserAllProjectCountPath);
    expect(readFetchPath(fetchMock.mock.calls[3]![0])).toContain('archiveState=archived');
  });

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
        data: createBrowserProjectsPageResult({
          currentOrganizationPermissions: [],
        }),
        onNavigate: (): void => undefined,
      }),
    );

    expect(markup).toContain('Project state');
    expect(markup).toContain('Archived');
  });

  it('redirects project overview loader browser redirects to login', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>().mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            code: 'unauthorized',
            message: 'Session expired.',
          },
        },
        401,
      ),
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectOverviewPageResult = await loadProjectOverviewPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/projects/billing'), {
        projectName: 'billing',
      }),
    );

    const redirectResponse: Response = requireRedirectResponse(result);
    expect(redirectResponse.headers.get('Location')).toBe('/login');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual(['/v1/orgs']);
  });

  it('redirects project overview API auth failures to login', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
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
        if (path === '/v1/projects/billing/overview') {
          return createJsonResponse(
            {
              error: {
                code: 'unauthorized',
                message: 'Session expired.',
              },
            },
            401,
          );
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserProjectOverviewPageResult = await loadProjectOverviewPageData(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/projects/billing'), {
        projectName: 'billing',
      }),
    );

    const redirectResponse: Response = requireRedirectResponse(result);
    expect(redirectResponse.headers.get('Location')).toBe('/login');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      browserProjectCountPath,
      '/v1/projects/billing/overview',
    ]);
  });
});
