import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { loadRolesPageData } from '../src/features/roles/roles-loader';
import {
  createLoaderArgs,
  createOrganizationListResponse,
  createWhoamiResponse,
  readFetchPath,
  type BrowserFetchCall,
  type BrowserRolesPageLoadResult,
  type FetchImplementation,
} from './browser-client-pages.helpers';
import { createJsonResponse } from './browser-test.fixtures';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('browser roles loader', (): void => {
  it('loads a validated roles return target from users', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createRolesFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserRolesPageLoadResult = await loadRolesPageData(
      createLoaderArgs(
        new Request('http://console.localhost/orgs/acme-dev/roles?returnTo=%2Forgs%2Facme-dev%2Fusers%3Fpage%3D2'),
      ),
    );

    if (result instanceof Response) throw new Error('Expected roles page result.');
    expect(result.backHref).toBe('/orgs/acme-dev/users?page=2');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual([
      '/v1/orgs',
      '/v1/whoami',
      '/v1/roles',
    ]);
  });

  it('ignores invalid roles return targets', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = createRolesFetchMock();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserRolesPageLoadResult = await loadRolesPageData(
      createLoaderArgs(
        new Request('http://console.localhost/orgs/acme-dev/roles?returnTo=%2Forgs%2Facme-dev%2Fprojects'),
      ),
    );

    if (result instanceof Response) throw new Error('Expected roles page result.');
    expect(result.backHref).toBeUndefined();
  });
});

function createRolesFetchMock(): Mock<FetchImplementation> {
  return vi.fn<FetchImplementation>().mockImplementation(async (input: string | URL | Request): Promise<Response> => {
    await Promise.resolve();
    const path: string = readFetchPath(input);
    if (path === '/v1/orgs') {
      return createJsonResponse(createOrganizationListResponse());
    }
    if (path === '/v1/whoami') {
      return createJsonResponse(createWhoamiResponse(['organization.role.read']));
    }
    if (path === '/v1/roles') {
      return createJsonResponse({
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
}
