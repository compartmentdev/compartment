import { z } from 'zod';
import { accessRoleKindSchema, permissionKeySchema } from './access.contract';
import { compartmentProjectNameSchema } from './compartment-descriptor.contract';
import type { ContractSchema } from './schema.types';
import { organizationUserSummarySchema } from './users.contract';
import { accessGroupSummarySchema, accessRoleSummarySchema } from './rbac-list.contract';
import type {
  AccessAssignmentListResponse,
  AccessAssignmentResponse,
  AccessAssignmentScopeOptionsResponse,
  AccessAssignmentScopeProjectOption,
  AccessAssignmentScopeTarget,
  AccessAssignmentSubjectSummary,
  AccessAssignmentSummary,
  AccessGroupMemberListResponse,
  AccessGroupMemberSummary,
  AccessGroupResponse,
  AccessRoleResponse,
  AddAccessGroupMemberRequest,
  CreateAccessAssignmentRequest,
  CreateAccessAssignmentSubject,
  CreateAccessGroupRequest,
  CreateAccessRoleRequest,
  EnvironmentAssignmentScopeTarget,
  GroupAccessAssignmentSubject,
  GroupAccessAssignmentSubjectSummary,
  OrganizationAssignmentScopeTarget,
  PrincipalAccessAssignmentSubject,
  PrincipalAccessAssignmentSubjectSummary,
  ProjectAssignmentScopeTarget,
  UpdateAccessGroupRequest,
  UpdateAccessRoleRequest,
  UserAccessDetail,
  UserAccessDetailResponse,
} from './rbac.contract.types';

export type {
  AccessAssignmentListResponse,
  AccessAssignmentResponse,
  AccessAssignmentScopeOptionsResponse,
  AccessAssignmentScopeProjectOption,
  AccessAssignmentScopeTarget,
  AccessAssignmentSubjectSummary,
  AccessAssignmentSummary,
  AccessGroupListOrderBy,
  AccessGroupListPageQuery,
  AccessGroupListPageResponse,
  AccessGroupListQuery,
  AccessGroupListResponse,
  AccessGroupListRow,
  AccessGroupListRouteResponse,
  AccessGroupListOptionsResponse,
  AccessGroupMemberListResponse,
  AccessGroupMemberSummary,
  AccessGroupResponse,
  AccessGroupSummary,
  AccessRoleListOrderBy,
  AccessRoleListPageQuery,
  AccessRoleListPageResponse,
  AccessRoleListQuery,
  AccessRoleListResponse,
  AccessRoleListRouteResponse,
  AccessRoleListRow,
  AccessRoleListOptionsResponse,
  AccessRoleResponse,
  AccessRoleSummary,
  AddAccessGroupMemberRequest,
  CreateAccessAssignmentRequest,
  CreateAccessGroupRequest,
  CreateAccessRoleRequest,
  OrganizationUserListRow,
  UpdateAccessGroupRequest,
  UpdateAccessRoleRequest,
  UserAccessDetail,
  UserAccessDetailResponse,
} from './rbac.contract.types';

const accessGroupMemberSummarySchema: ContractSchema<AccessGroupMemberSummary> = z
  .object({
    email: z.string().email(),
    id: z.string().min(1),
    status: z.enum(['active', 'invited']),
  })
  .strict();

const organizationAssignmentScopeTargetSchema: ContractSchema<OrganizationAssignmentScopeTarget> = z
  .object({ scopeType: z.literal('organization') })
  .strict();
const projectAssignmentScopeTargetSchema: ContractSchema<ProjectAssignmentScopeTarget> = z
  .object({
    projectName: compartmentProjectNameSchema,
    scopeType: z.literal('project'),
  })
  .strict();
const environmentAssignmentScopeTargetSchema: ContractSchema<EnvironmentAssignmentScopeTarget> = z
  .object({
    environmentName: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    scopeType: z.literal('environment'),
  })
  .strict();

const accessAssignmentScopeTargetSchema: ContractSchema<AccessAssignmentScopeTarget> = z.union([
  organizationAssignmentScopeTargetSchema,
  projectAssignmentScopeTargetSchema,
  environmentAssignmentScopeTargetSchema,
]);

const principalAccessAssignmentSubjectSchema: ContractSchema<PrincipalAccessAssignmentSubject> = z
  .object({
    principalEmail: z.string().email(),
    subjectType: z.literal('principal'),
  })
  .strict();
const groupAccessAssignmentSubjectSchema: ContractSchema<GroupAccessAssignmentSubject> = z
  .object({
    groupId: z.string().min(1),
    subjectType: z.literal('group'),
  })
  .strict();
const createAccessAssignmentSubjectSchema: ContractSchema<CreateAccessAssignmentSubject> = z.union([
  principalAccessAssignmentSubjectSchema,
  groupAccessAssignmentSubjectSchema,
]);

const principalAccessAssignmentSubjectSummarySchema: ContractSchema<PrincipalAccessAssignmentSubjectSummary> = z
  .object({
    principalEmail: z.string().email(),
    subjectType: z.literal('principal'),
  })
  .strict();
const groupAccessAssignmentSubjectSummarySchema: ContractSchema<GroupAccessAssignmentSubjectSummary> = z
  .object({
    groupId: z.string().min(1),
    groupName: z.string().min(1),
    subjectType: z.literal('group'),
  })
  .strict();
const accessAssignmentSubjectSummarySchema: ContractSchema<AccessAssignmentSubjectSummary> = z.union([
  principalAccessAssignmentSubjectSummarySchema,
  groupAccessAssignmentSubjectSummarySchema,
]);

const accessAssignmentSummarySchema: ContractSchema<AccessAssignmentSummary> = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().min(1),
    roleId: z.string().min(1),
    roleKind: accessRoleKindSchema,
    roleName: z.string().min(1),
    scope: accessAssignmentScopeTargetSchema,
    subject: accessAssignmentSubjectSummarySchema,
  })
  .strict();

export const accessRoleResponseSchema: ContractSchema<AccessRoleResponse> = z
  .object({ role: accessRoleSummarySchema })
  .strict();
export const createAccessRoleRequestSchema: ContractSchema<CreateAccessRoleRequest> = z
  .object({
    description: z.string().min(1).nullable().optional(),
    name: z.string().min(1),
    permissionKeys: z.array(permissionKeySchema),
  })
  .strict();
export const updateAccessRoleRequestSchema: ContractSchema<UpdateAccessRoleRequest> = z
  .object({
    description: z.string().min(1).nullable().optional(),
    name: z.string().min(1).optional(),
    permissionKeys: z.array(permissionKeySchema).optional(),
  })
  .strict();

export const accessGroupResponseSchema: ContractSchema<AccessGroupResponse> = z
  .object({ group: accessGroupSummarySchema })
  .strict();
export const createAccessGroupRequestSchema: ContractSchema<CreateAccessGroupRequest> = z
  .object({
    description: z.string().min(1).nullable().optional(),
    name: z.string().min(1),
  })
  .strict();
export const updateAccessGroupRequestSchema: ContractSchema<UpdateAccessGroupRequest> = z
  .object({
    description: z.string().min(1).nullable().optional(),
    name: z.string().min(1),
  })
  .strict();
export const accessGroupMemberListResponseSchema: ContractSchema<AccessGroupMemberListResponse> = z
  .object({ members: z.array(accessGroupMemberSummarySchema) })
  .strict();
export const addAccessGroupMemberRequestSchema: ContractSchema<AddAccessGroupMemberRequest> = z
  .object({ email: z.string().email() })
  .strict();

export const createAccessAssignmentRequestSchema: ContractSchema<CreateAccessAssignmentRequest> = z
  .object({
    roleId: z.string().min(1),
    scope: accessAssignmentScopeTargetSchema,
    subject: createAccessAssignmentSubjectSchema,
  })
  .strict();
export const accessAssignmentResponseSchema: ContractSchema<AccessAssignmentResponse> = z
  .object({ assignment: accessAssignmentSummarySchema })
  .strict();
export const accessAssignmentListResponseSchema: ContractSchema<AccessAssignmentListResponse> = z
  .object({ assignments: z.array(accessAssignmentSummarySchema) })
  .strict();
const accessAssignmentScopeProjectOptionSchema: ContractSchema<AccessAssignmentScopeProjectOption> = z
  .object({
    environmentNames: z.array(z.string().min(1)),
    projectName: compartmentProjectNameSchema,
  })
  .strict();
export const accessAssignmentScopeOptionsResponseSchema: ContractSchema<AccessAssignmentScopeOptionsResponse> = z
  .object({ projects: z.array(accessAssignmentScopeProjectOptionSchema) })
  .strict();

const userAccessDetailSchema: ContractSchema<UserAccessDetail> = z
  .object({
    directAssignments: z.array(accessAssignmentSummarySchema),
    effectivePermissions: z.array(permissionKeySchema),
    groups: z.array(accessGroupSummarySchema),
    user: organizationUserSummarySchema,
  })
  .strict();

export const userAccessDetailResponseSchema: ContractSchema<UserAccessDetailResponse> = z
  .object({ access: userAccessDetailSchema })
  .strict();

export {
  accessGroupListResponseSchema,
  accessGroupListOptionsResponseSchema,
  accessGroupListPageResponseSchema,
  accessGroupListQuerySchema,
  accessGroupListRouteResponseSchema,
  accessRoleListResponseSchema,
  accessRoleListOptionsResponseSchema,
  accessRoleListPageResponseSchema,
  accessRoleListQuerySchema,
  accessRoleListRouteResponseSchema,
} from './rbac-list.contract';
