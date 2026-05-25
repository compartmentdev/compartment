import { z } from 'zod';
import { compartmentProjectNameSchema, compartmentServiceKindSchema } from './compartment-descriptor.contract';
import {
  listPageQuerySchema,
  listPaginationSchema,
  listPerPageQuerySchema,
  listSortDirectionSchema,
  type ListSortDirection,
} from './list.contract';
import type { ProjectLifecycleAction, ProjectLifecycleState } from './project-lifecycle.contract';
import type {
  ExistingProjectRemoteState,
  ProjectArchiveState,
  ProjectEnvironmentOverview,
  ProjectDeleteResponse,
  ProjectListDetail,
  ProjectListQuery,
  ProjectListOrderBy,
  ProjectListResponse,
  ProjectOverviewResponse,
  ProjectOperationalStatus,
  ProjectOverviewSummary,
  ProjectReadResponse,
  ProjectRemoteState,
  ProjectResponse,
  ProjectRouteTargetSummary,
  ProjectScopedOperationalStatus,
  ProjectServiceOverview,
  ProjectShowResponse,
  ProjectStatusListResponse,
  ProjectStatusSummary,
  ProjectSummary,
  RenameProjectRequest,
} from './projects.contract.types';
import type { ContractSchema } from './schema.types';

export * from './projects.contract.types';

interface ProjectListQueryInput {
  archiveState?: ProjectArchiveState | undefined;
  detail?: ProjectListDetail | undefined;
  orderBy?: ProjectListOrderBy | undefined;
  page?: number | string | undefined;
  perPage?: number | string | undefined;
  projectIds?: string | string[] | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
}

const existingProjectRemoteStateSchema: ContractSchema<ExistingProjectRemoteState> = z.enum(['active', 'disconnected']);
const projectRemoteStateSchema: ContractSchema<ProjectRemoteState> = z.enum(['active', 'disconnected', 'not_created']);
const projectArchiveStateSchema: ContractSchema<ProjectArchiveState> = z.enum(['active', 'archived', 'all']);
const projectListDetailSchema: ContractSchema<ProjectListDetail> = z.enum(['overview', 'status', 'summary']);
const projectListOrderBySchema: ContractSchema<ProjectListOrderBy> = z.enum([
  'lastDeploymentCreatedAt',
  'name',
  'serviceCount',
  'status',
  'updatedAt',
]);
const projectOperationalStatusSchema: ContractSchema<ProjectOperationalStatus> = z.enum([
  'archived',
  'healthy',
  'needs_attention',
  'not_deployed',
  'stopped',
  'updating',
]);
const projectScopedOperationalStatusSchema: ContractSchema<ProjectScopedOperationalStatus> = z.enum([
  'healthy',
  'needs_attention',
  'not_deployed',
  'stopped',
  'updating',
]);
const projectLifecycleActionSchema: ContractSchema<ProjectLifecycleAction> = z.enum(['start', 'stop']);
const projectLifecycleStateSchema: ContractSchema<ProjectLifecycleState> = z.enum([
  'needs_attention',
  'not_deployed',
  'running',
  'stopped',
  'updating',
]);
interface ProjectSummarySchemaShape {
  archivedAt: z.ZodNullable<z.ZodString>;
  createdAt: z.ZodString;
  id: z.ZodString;
  name: typeof compartmentProjectNameSchema;
  organizationId: z.ZodString;
  updatedAt: z.ZodString;
}

const projectSummarySchemaShape: ProjectSummarySchemaShape = {
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  id: z.string().min(1),
  name: compartmentProjectNameSchema,
  organizationId: z.string().min(1),
  updatedAt: z.string().datetime(),
};

export const projectSummarySchema: ContractSchema<ProjectSummary> = z.object({ ...projectSummarySchemaShape }).strict();

const projectRouteTargetSummarySchema: ContractSchema<ProjectRouteTargetSummary> = z
  .object({
    environmentName: z.string().min(1),
    routeUrl: z.string().url(),
    serviceName: z.string().min(1),
  })
  .strict();

const projectStatusSummarySchema: ContractSchema<ProjectStatusSummary> = z
  .object({
    id: z.string().min(1),
    lifecycleAction: projectLifecycleActionSchema.nullable(),
    lifecycleDisabledReason: z.string().min(1).nullable(),
    lifecycleState: projectLifecycleStateSchema.nullable(),
    openTargets: z.array(projectRouteTargetSummarySchema),
    routeUrl: z.string().url().nullable(),
    status: projectOperationalStatusSchema,
  })
  .strict();

const projectServiceOverviewSchema: ContractSchema<ProjectServiceOverview> = z
  .object({
    kind: compartmentServiceKindSchema,
    lastDeploymentCreatedAt: z.string().datetime().nullable(),
    name: z.string().min(1),
    routeUrl: z.string().url().nullable(),
    status: projectScopedOperationalStatusSchema,
  })
  .strict();

const projectEnvironmentOverviewSchema: ContractSchema<ProjectEnvironmentOverview> = z
  .object({
    name: z.string().min(1),
    services: z.array(projectServiceOverviewSchema),
    status: projectScopedOperationalStatusSchema,
  })
  .strict();

const projectOverviewSummarySchema: ContractSchema<ProjectOverviewSummary> = z
  .object({
    ...projectSummarySchemaShape,
    canManageArchive: z.boolean(),
    canReadDeployments: z.boolean(),
    canManageLifecycle: z.boolean(),
    environmentName: z.string().min(1),
    lastDeploymentCreatedAt: z.string().datetime().nullable(),
    lifecycleAction: projectLifecycleActionSchema.nullable(),
    lifecycleDisabledReason: z.string().min(1).nullable(),
    lifecycleState: projectLifecycleStateSchema.nullable(),
    openTargets: z.array(projectRouteTargetSummarySchema),
    routeUrl: z.string().url().nullable(),
    serviceCount: z.number().int().nonnegative(),
    status: projectOperationalStatusSchema,
  })
  .strict();

export const projectResponseSchema: ContractSchema<ProjectResponse> = z
  .object({
    project: projectSummarySchema,
  })
  .strict();

export const projectReadResponseSchema: ContractSchema<ProjectReadResponse> = z
  .object({
    project: projectSummarySchema,
    remoteState: existingProjectRemoteStateSchema,
  })
  .strict();

export const projectOverviewResponseSchema: ContractSchema<ProjectOverviewResponse> = z
  .object({
    environments: z.array(projectEnvironmentOverviewSchema),
    project: projectOverviewSummarySchema,
  })
  .strict();

export const projectDeleteResponseSchema: ContractSchema<ProjectDeleteResponse> = z
  .object({
    projectName: compartmentProjectNameSchema,
  })
  .strict();

const projectStatusListResponseObjectSchema: z.ZodObject<{
  detail: z.ZodLiteral<'status'>;
  projects: z.ZodArray<typeof projectStatusSummarySchema>;
}> = z
  .object({
    detail: z.literal('status'),
    projects: z.array(projectStatusSummarySchema),
  })
  .strict();

export const projectStatusListResponseSchema: ContractSchema<ProjectStatusListResponse> =
  projectStatusListResponseObjectSchema;

export const projectListResponseSchema: ContractSchema<ProjectListResponse> = z.discriminatedUnion('detail', [
  z
    .object({
      detail: z.literal('summary'),
      pagination: listPaginationSchema,
      projects: z.array(projectSummarySchema),
    })
    .strict(),
  projectStatusListResponseObjectSchema,
  z
    .object({
      detail: z.literal('overview'),
      pagination: listPaginationSchema,
      projects: z.array(projectOverviewSummarySchema),
    })
    .strict(),
]);

const projectIdsQuerySchema: z.ZodType<string[] | undefined, z.ZodTypeDef, string | string[] | undefined> = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  .optional()
  .transform(readProjectIdsQueryValue);

export const projectListQuerySchema: z.ZodType<ProjectListQuery, z.ZodTypeDef, ProjectListQueryInput> = z
  .object({
    archiveState: projectArchiveStateSchema.optional(),
    detail: projectListDetailSchema.optional(),
    orderBy: projectListOrderBySchema.optional(),
    page: listPageQuerySchema.optional(),
    perPage: listPerPageQuerySchema.optional(),
    projectIds: projectIdsQuerySchema,
    search: z.string().optional(),
    sort: listSortDirectionSchema.optional(),
  })
  .strict()
  .superRefine((value: ProjectListQuery, context: z.RefinementCtx): void => {
    if (value.detail === 'status' && value.projectIds === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected projectIds when detail=status.',
        path: ['projectIds'],
      });
    }
    if (value.detail !== 'status' && value.projectIds !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'projectIds is supported only when detail=status.',
        path: ['projectIds'],
      });
    }
  });

function readProjectIdsQueryValue(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}

export const renameProjectRequestSchema: ContractSchema<RenameProjectRequest> = z
  .object({
    name: compartmentProjectNameSchema,
  })
  .strict();

export const projectShowResponseSchema: ContractSchema<ProjectShowResponse> = z
  .object({
    descriptorFile: z.string().min(1).nullable(),
    localProjectName: compartmentProjectNameSchema.nullable(),
    project: projectSummarySchema.nullable(),
    remoteState: projectRemoteStateSchema,
  })
  .strict();
