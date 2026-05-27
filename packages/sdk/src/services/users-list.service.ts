import {
  compartmentUsersApiPathname,
  userListResponseSchema,
  type UserListQuery,
  type UserListResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function listUsers(request: CompartmentRequester, query: UserListQuery = {}): Promise<UserListResponse> {
  return await request<UserListResponse, undefined>({
    method: 'GET',
    path: buildUserListPath(query),
    schema: userListResponseSchema,
  });
}

function buildUserListPath(query: UserListQuery): string {
  return buildListPath(compartmentUsersApiPathname, [
    { name: 'orderBy', value: query.orderBy },
    { name: 'page', value: query.page },
    { name: 'perPage', value: query.perPage },
    { name: 'search', value: query.search },
    { name: 'sort', value: query.sort },
    { name: 'type', value: query.type },
  ]);
}
