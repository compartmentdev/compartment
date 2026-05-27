import { z } from 'zod';
import { accessSummaryLabelSchema } from './access.contract';
import {
  listPageQuerySchema,
  listPaginationSchema,
  listPerPageQuerySchema,
  listSortDirectionSchema,
  type ListPagination,
  type ListSortDirection,
} from './list.contract';
import type { OrganizationUserListRow } from './rbac.contract.types';
import type { ContractSchema } from './schema.types';

export type OrganizationUserAccess = 'allowed' | 'blocked';
export type OrganizationUserStatus = 'active' | 'invited';
export type OrganizationUserType = 'user' | 'automation';
export type UserListOrderBy = 'email' | 'status';

export interface OrganizationUserSummary {
  access: OrganizationUserAccess;
  email: string;
  groupCount: number;
  id: string;
  roleNames: string[];
  status: OrganizationUserStatus;
  type: OrganizationUserType;
}

export interface InviteUserRequest {
  email: string;
}

export interface UserInvitation {
  activationUrl: string;
  bootstrapExpiresAt: string;
  bootstrapToken: string;
}

export interface InviteUserResponse {
  invitation: UserInvitation | null;
  user: OrganizationUserSummary;
}

export interface OrganizationUserResponse {
  user: OrganizationUserSummary;
}

export interface RemoveUserResponse {
  success: true;
}

export interface UserListResponse {
  pagination: ListPagination;
  users: OrganizationUserListRow[];
}

export interface UserListQuery {
  orderBy?: UserListOrderBy | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
  type?: OrganizationUserType | undefined;
}

interface UserListQueryInput {
  orderBy?: UserListOrderBy | undefined;
  page?: number | string | undefined;
  perPage?: number | string | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
  type?: OrganizationUserType | undefined;
}

const organizationUserStatusSchema: ContractSchema<OrganizationUserStatus> = z.enum(['active', 'invited']);
const organizationUserAccessSchema: ContractSchema<OrganizationUserAccess> = z.enum(['allowed', 'blocked']);
const organizationUserTypeSchema: ContractSchema<OrganizationUserType> = z.enum(['user', 'automation']);
const userListOrderBySchema: ContractSchema<UserListOrderBy> = z.enum(['email', 'status']);
const organizationUserSummarySchemaFields: {
  access: typeof organizationUserAccessSchema;
  email: z.ZodString;
  groupCount: z.ZodNumber;
  id: z.ZodString;
  roleNames: z.ZodArray<z.ZodString>;
  status: typeof organizationUserStatusSchema;
  type: typeof organizationUserTypeSchema;
} = {
  access: organizationUserAccessSchema,
  email: z.string().email(),
  groupCount: z.number().int().nonnegative(),
  id: z.string().min(1),
  roleNames: z.array(z.string().min(1)),
  status: organizationUserStatusSchema,
  type: organizationUserTypeSchema,
};

export const organizationUserSummarySchema: ContractSchema<OrganizationUserSummary> = z
  .object(organizationUserSummarySchemaFields)
  .strict();

export const inviteUserRequestSchema: ContractSchema<InviteUserRequest> = z
  .object({
    email: z.string().email(),
  })
  .strict();

const userInvitationSchema: ContractSchema<UserInvitation> = z
  .object({
    activationUrl: z.string().url(),
    bootstrapExpiresAt: z.string().datetime(),
    bootstrapToken: z.string().min(1),
  })
  .strict();

export const inviteUserResponseSchema: ContractSchema<InviteUserResponse> = z
  .object({
    invitation: userInvitationSchema.nullable(),
    user: organizationUserSummarySchema,
  })
  .strict();

export const organizationUserResponseSchema: ContractSchema<OrganizationUserResponse> = z
  .object({
    user: organizationUserSummarySchema,
  })
  .strict();

const organizationUserListRowSchema: ContractSchema<OrganizationUserListRow> = z
  .object({
    ...organizationUserSummarySchemaFields,
    accessSummary: accessSummaryLabelSchema,
    directAccessScopeLabels: z.array(z.string().min(1)),
    groupNames: z.array(z.string().min(1)),
  })
  .strict();

export const removeUserResponseSchema: ContractSchema<RemoveUserResponse> = z
  .object({
    success: z.literal(true),
  })
  .strict();

export const userListResponseSchema: ContractSchema<UserListResponse> = z
  .object({
    pagination: listPaginationSchema,
    users: z.array(organizationUserListRowSchema),
  })
  .strict();

export const userListQuerySchema: z.ZodType<UserListQuery, z.ZodTypeDef, UserListQueryInput> = z
  .object({
    orderBy: userListOrderBySchema.optional(),
    page: listPageQuerySchema.optional(),
    perPage: listPerPageQuerySchema.optional(),
    search: z.string().optional(),
    sort: listSortDirectionSchema.optional(),
    type: organizationUserTypeSchema.optional(),
  })
  .strict();
