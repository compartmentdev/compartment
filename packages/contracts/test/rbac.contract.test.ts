import { describe, expect, it } from 'vitest';
import {
  accessGroupListOptionsResponseSchema,
  accessGroupListPageResponseSchema,
  accessGroupListQuerySchema,
  accessRoleListOptionsResponseSchema,
  accessRoleListPageResponseSchema,
  accessRoleListQuerySchema,
} from '../src';

describe('rbac list contracts', (): void => {
  it('parses paginated role list queries and responses', (): void => {
    expect(
      accessRoleListQuerySchema.parse({
        detail: 'list',
        orderBy: 'assignmentCount',
        page: '2',
        perPage: '20',
        search: 'admin',
        sort: 'desc',
      }),
    ).toEqual({
      detail: 'list',
      orderBy: 'assignmentCount',
      page: 2,
      perPage: 20,
      search: 'admin',
      sort: 'desc',
    });

    expect(
      accessRoleListPageResponseSchema.parse({
        detail: 'list',
        pagination: {
          page: 2,
          perPage: 20,
          totalItems: 42,
          totalPages: 3,
        },
        roles: [
          {
            assignmentCount: 7,
            description: 'Administrators',
            groupCount: 2,
            id: 'rol_123',
            kind: 'custom',
            name: 'Admin',
            permissionKeys: ['organization.user.invite'],
            principalCount: 5,
          },
        ],
      }).pagination.totalItems,
    ).toBe(42);

    expect(accessRoleListQuerySchema.safeParse({ page: '2' }).success).toBe(false);
    expect(accessRoleListOptionsResponseSchema.parse({ detail: 'options', roles: [] }).detail).toBe('options');
  });

  it('parses paginated group list queries and responses', (): void => {
    expect(
      accessGroupListQuerySchema.parse({
        detail: 'list',
        orderBy: 'memberCount',
        page: '3',
        perPage: '10',
        search: 'ops',
        sort: 'asc',
      }),
    ).toEqual({
      detail: 'list',
      orderBy: 'memberCount',
      page: 3,
      perPage: 10,
      search: 'ops',
      sort: 'asc',
    });

    expect(
      accessGroupListPageResponseSchema.parse({
        detail: 'list',
        groups: [
          {
            assignedRoleNames: ['Operator'],
            assignmentCount: 2,
            assignmentScopeLabels: ['org-wide'],
            description: 'Operations',
            id: 'grp_123',
            memberCount: 4,
            name: 'Ops',
          },
        ],
        pagination: {
          page: 1,
          perPage: 10,
          totalItems: 1,
          totalPages: 1,
        },
      }).groups[0]?.name,
    ).toBe('Ops');

    expect(accessGroupListQuerySchema.safeParse({ detail: 'options', page: '2' }).success).toBe(false);
    expect(accessGroupListOptionsResponseSchema.parse({ detail: 'options', groups: [] }).detail).toBe('options');
  });
});
