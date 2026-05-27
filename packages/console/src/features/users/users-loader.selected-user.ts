import {
  type OrganizationUserListRow,
  userListResponseSchema,
  type UserListResponse,
} from '@compartment/contracts/browser';
import { requestBrowserApi, type BrowserApiRequestOptions } from '../../lib/browser-api';
import { usersApiPathname } from '../../routes/users/users-api-paths';
import type { UsersLoaderQuery } from './users-loader.helpers';

export async function resolveSelectedConsoleUserEmail(
  query: UsersLoaderQuery,
  users: readonly OrganizationUserListRow[],
  organizationSlug: string,
  options: BrowserApiRequestOptions,
): Promise<string | null> {
  if (query.mode !== 'detail' || query.selectedUserEmail === null) {
    return null;
  }
  if (users.some((user: OrganizationUserListRow): boolean => user.email === query.selectedUserEmail)) {
    return query.selectedUserEmail;
  }

  return (await findConsoleUserByEmail(query.selectedUserEmail, organizationSlug, options))
    ? query.selectedUserEmail
    : null;
}

async function findConsoleUserByEmail(
  email: string,
  organizationSlug: string,
  options: BrowserApiRequestOptions,
): Promise<boolean> {
  const response: UserListResponse = await requestBrowserApi<UserListResponse>(
    buildSelectedUserLookupPath(email),
    userListResponseSchema,
    {
      currentOrganization: organizationSlug,
      signal: options.signal,
    },
  );

  return response.users.some((user: OrganizationUserListRow): boolean => user.email === email);
}

function buildSelectedUserLookupPath(email: string): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  searchParams.set('orderBy', 'email');
  searchParams.set('type', 'user');
  searchParams.set('sort', 'asc');
  searchParams.set('page', '1');
  searchParams.set('perPage', '1');
  searchParams.set('search', email);

  return `${usersApiPathname}?${searchParams.toString()}`;
}
