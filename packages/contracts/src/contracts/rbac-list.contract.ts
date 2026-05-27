import { z } from 'zod';
import { accessRoleKindSchema, permissionKeySchema } from './access.contract';
import {
  listPageQuerySchema,
  listPaginationSchema,
  listPerPageQuerySchema,
  listSortDirectionSchema,
  type ListSortDirection,
} from './list.contract';
import type { ContractSchema } from './schema.types';
import type {
  AccessGroupListOrderBy,
  AccessGroupListOptionsResponse,
  AccessGroupListPageResponse,
  AccessGroupListQuery,
  AccessGroupListResponse,
  AccessGroupListRouteResponse,
  AccessGroupListRow,
  AccessGroupListPageQuery,
  AccessGroupListOptionsQuery,
  AccessGroupLegacyListQuery,
  AccessGroupSummary,
  AccessRoleListOrderBy,
  AccessRoleListOptionsResponse,
  AccessRoleListPageResponse,
  AccessRoleListQuery,
  AccessRoleListResponse,
  AccessRoleListRouteResponse,
  AccessRoleListRow,
  AccessRoleListPageQuery,
  AccessRoleListOptionsQuery,
  AccessRoleLegacyListQuery,
  AccessRoleSummary,
} from './rbac.contract.types';

interface AccessRoleLegacyListQueryInput {
  detail?: undefined;
}

interface AccessRoleListOptionsQueryInput {
  detail: 'options';
}

interface AccessRoleListPageQueryInput {
  detail: 'list';
  orderBy?: AccessRoleListOrderBy | undefined;
  page?: number | string | undefined;
  perPage?: number | string | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
}

type AccessRoleListQueryInput =
  | AccessRoleLegacyListQueryInput
  | AccessRoleListOptionsQueryInput
  | AccessRoleListPageQueryInput;

interface AccessGroupLegacyListQueryInput {
  detail?: undefined;
}

interface AccessGroupListOptionsQueryInput {
  detail: 'options';
}

interface AccessGroupListPageQueryInput {
  detail: 'list';
  orderBy?: AccessGroupListOrderBy | undefined;
  page?: number | string | undefined;
  perPage?: number | string | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
}

type AccessGroupListQueryInput =
  | AccessGroupLegacyListQueryInput
  | AccessGroupListOptionsQueryInput
  | AccessGroupListPageQueryInput;

export const accessRoleSummarySchema: ContractSchema<AccessRoleSummary> = z
  .object({
    description: z.string().min(1).nullable(),
    id: z.string().min(1),
    kind: accessRoleKindSchema,
    name: z.string().min(1),
    permissionKeys: z.array(permissionKeySchema),
  })
  .strict();

const accessRoleListRowSchema: ContractSchema<AccessRoleListRow> = z
  .object({
    description: z.string().min(1).nullable(),
    id: z.string().min(1),
    kind: accessRoleKindSchema,
    name: z.string().min(1),
    permissionKeys: z.array(permissionKeySchema),
    assignmentCount: z.number().int().nonnegative(),
    groupCount: z.number().int().nonnegative(),
    principalCount: z.number().int().nonnegative(),
  })
  .strict();

const accessRoleListOrderBySchema: ContractSchema<AccessRoleListOrderBy> = z.enum(['assignmentCount', 'kind', 'name']);

export const accessGroupSummarySchema: ContractSchema<AccessGroupSummary> = z
  .object({
    assignmentCount: z.number().int().nonnegative(),
    description: z.string().min(1).nullable(),
    id: z.string().min(1),
    memberCount: z.number().int().nonnegative(),
    name: z.string().min(1),
  })
  .strict();

const accessGroupListRowSchema: ContractSchema<AccessGroupListRow> = z
  .object({
    assignmentCount: z.number().int().nonnegative(),
    description: z.string().min(1).nullable(),
    id: z.string().min(1),
    memberCount: z.number().int().nonnegative(),
    name: z.string().min(1),
    assignedRoleNames: z.array(z.string().min(1)),
    assignmentScopeLabels: z.array(z.string().min(1)),
  })
  .strict();

const accessGroupListOrderBySchema: ContractSchema<AccessGroupListOrderBy> = z.enum([
  'assignmentCount',
  'memberCount',
  'name',
]);

export const accessRoleListResponseSchema: ContractSchema<AccessRoleListResponse> = z
  .object({ roles: z.array(accessRoleListRowSchema) })
  .strict();
export const accessRoleListOptionsResponseSchema: ContractSchema<AccessRoleListOptionsResponse> = z
  .object({
    detail: z.literal('options'),
    roles: z.array(accessRoleListRowSchema),
  })
  .strict();
export const accessRoleListPageResponseSchema: ContractSchema<AccessRoleListPageResponse> = z
  .object({
    detail: z.literal('list'),
    pagination: listPaginationSchema,
    roles: z.array(accessRoleListRowSchema),
  })
  .strict();
export const accessRoleListRouteResponseSchema: ContractSchema<AccessRoleListRouteResponse> = z.union([
  accessRoleListResponseSchema,
  accessRoleListOptionsResponseSchema,
  accessRoleListPageResponseSchema,
]);
const accessRoleLegacyListQuerySchema: ContractSchema<AccessRoleLegacyListQuery> = z
  .object({ detail: z.undefined().optional() })
  .strict();
const accessRoleListOptionsQuerySchema: ContractSchema<AccessRoleListOptionsQuery> = z
  .object({ detail: z.literal('options') })
  .strict();
const accessRoleListPageQuerySchema: z.ZodType<AccessRoleListPageQuery, z.ZodTypeDef, AccessRoleListPageQueryInput> = z
  .object({
    detail: z.literal('list'),
    orderBy: accessRoleListOrderBySchema.optional(),
    page: listPageQuerySchema.optional(),
    perPage: listPerPageQuerySchema.optional(),
    search: z.string().optional(),
    sort: listSortDirectionSchema.optional(),
  })
  .strict();
export const accessRoleListQuerySchema: z.ZodType<AccessRoleListQuery, z.ZodTypeDef, AccessRoleListQueryInput> =
  z.union([accessRoleLegacyListQuerySchema, accessRoleListOptionsQuerySchema, accessRoleListPageQuerySchema]);

export const accessGroupListResponseSchema: ContractSchema<AccessGroupListResponse> = z
  .object({ groups: z.array(accessGroupListRowSchema) })
  .strict();
export const accessGroupListOptionsResponseSchema: ContractSchema<AccessGroupListOptionsResponse> = z
  .object({
    detail: z.literal('options'),
    groups: z.array(accessGroupListRowSchema),
  })
  .strict();
export const accessGroupListPageResponseSchema: ContractSchema<AccessGroupListPageResponse> = z
  .object({
    detail: z.literal('list'),
    groups: z.array(accessGroupListRowSchema),
    pagination: listPaginationSchema,
  })
  .strict();
export const accessGroupListRouteResponseSchema: ContractSchema<AccessGroupListRouteResponse> = z.union([
  accessGroupListResponseSchema,
  accessGroupListOptionsResponseSchema,
  accessGroupListPageResponseSchema,
]);
const accessGroupLegacyListQuerySchema: ContractSchema<AccessGroupLegacyListQuery> = z
  .object({ detail: z.undefined().optional() })
  .strict();
const accessGroupListOptionsQuerySchema: ContractSchema<AccessGroupListOptionsQuery> = z
  .object({ detail: z.literal('options') })
  .strict();
const accessGroupListPageQuerySchema: z.ZodType<AccessGroupListPageQuery, z.ZodTypeDef, AccessGroupListPageQueryInput> =
  z
    .object({
      detail: z.literal('list'),
      orderBy: accessGroupListOrderBySchema.optional(),
      page: listPageQuerySchema.optional(),
      perPage: listPerPageQuerySchema.optional(),
      search: z.string().optional(),
      sort: listSortDirectionSchema.optional(),
    })
    .strict();
export const accessGroupListQuerySchema: z.ZodType<AccessGroupListQuery, z.ZodTypeDef, AccessGroupListQueryInput> =
  z.union([accessGroupLegacyListQuerySchema, accessGroupListOptionsQuerySchema, accessGroupListPageQuerySchema]);
