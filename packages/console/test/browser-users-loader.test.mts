import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { loadUsersPageData } from '../src/features/users/users-loader';
import { createJsonResponse } from './browser-test.fixtures';
import {
  createConsoleAdminPermissions,
  createLoaderArgs,
  createOrganizationListResponse,
  createProjectCountResponse,
  createWhoamiResponse,
  readFetchPath,
  type BrowserFetchCall,
  type BrowserUsersPageLoadResult,
  type FetchImplementation,
} from './browser-client-pages.helpers';

const browserProjectCountPath: string =
  '/v1/projects?archiveState=active&detail=overview&orderBy=updatedAt&page=1&perPage=1&sort=desc';

describe('browser users loader', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('clears automation detail deep links from the browser users page', async (): Promise<void> => {
    const automationEmail: string = 'git-source+src_123@compartment.internal';
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
          return createJsonResponse(createProjectCountResponse());
        }
        if (path === '/v1/users?orderBy=email&type=user&sort=asc&page=1&perPage=10') {
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
        if (
          path ===
          `/v1/users?orderBy=email&type=user&sort=asc&page=1&perPage=1&search=${encodeURIComponent(automationEmail)}`
        ) {
          return createJsonResponse({
            pagination: {
              page: 1,
              perPage: 1,
              totalItems: 0,
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

    const result: BrowserUsersPageLoadResult = await loadUsersPageData(
      createLoaderArgs(
        new Request(`http://console.localhost/orgs/acme-dev/users?userEmail=${encodeURIComponent(automationEmail)}`),
      ),
    );

    if (result instanceof Response) {
      throw new Error('Expected users page result.');
    }
    expect(result.mode).toBe('list');
    expect(result.selectedUserEmail).toBeNull();
    expect(result.selectedUserAccess).toBeNull();
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      '/v1/users?orderBy=email&type=user&sort=asc&page=1&perPage=10',
      '/v1/roles?detail=options',
      '/v1/groups?detail=options',
      '/v1/assignments/scope-options',
      `/v1/users?orderBy=email&type=user&sort=asc&page=1&perPage=1&search=${encodeURIComponent(automationEmail)}`,
    ]);
  });
});
