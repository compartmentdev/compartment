import { z } from 'zod';
import { compartmentProjectNameSchema, compartmentResourceNameSchema } from './compartment-descriptor.contract';
import {
  compartmentResourceOperationRetentionConfigSchema,
  compartmentResourceOperationScheduleConfigSchema,
} from './compartment-resource.contract';
import type {
  CompartmentResourceOperationRetentionConfig,
  CompartmentResourceOperationScheduleConfig,
} from './compartment-descriptor.types';
import { environmentNameSchema } from './deployments.contract';
import { environmentSummarySchema, type EnvironmentSummary } from './environments.contract';
import { projectSummarySchema, type ProjectSummary } from './projects.contract';
import {
  resourceSummarySchema,
  resourceVolumeSummarySchema,
  type ResourceListQuery,
  type ResourceSummary,
  type ResourceVolumeSummary,
} from './resources.contract';
import type { ContractSchema } from './schema.types';

export type ResourceRestoreConfirmation = 'restore-resource-backup';
export const resourceRestoreConfirmation: ResourceRestoreConfirmation = 'restore-resource-backup';
export const compartmentResourceBackupsPathname: string = '/v1/resource-backups';
export const compartmentResourceBackupShowPathnameTemplate: string = `${compartmentResourceBackupsPathname}/:backupId`;
export const compartmentResourceBackupRestorePathnameTemplate: string = `${compartmentResourceBackupShowPathnameTemplate}/restore`;
export type ResourceBackupStatus = 'running' | 'succeeded' | 'failed' | 'deleted';
export type ResourceBackupPurpose = 'manual' | 'pre_restore' | 'scheduled';

export interface ResourceBackupManifest {
  artifactLocation: string;
  backupId: string;
  checksum: string | null;
  createdAt: string;
  createdBy: string | null;
  environment: EnvironmentSummary;
  failureSummary: string | null;
  operationConfigHash: string;
  operationImage: string;
  project: ProjectSummary;
  resource: ResourceSummary;
  resourceImage: string;
  resourceRuntimeDefinitionHash: string;
  size: number | null;
  status: ResourceBackupStatus;
  volumes: ResourceVolumeSummary[];
}

export interface ResourceBackupShowQuery extends ResourceListQuery {
  backupId: string;
}

export interface ResourceBackupSummary {
  artifactLocation: string | null;
  checksum: string | null;
  completedAt: string | null;
  createdAt: string;
  failureSummary: string | null;
  id: string;
  purpose: ResourceBackupPurpose;
  retentionDeletedAt: string | null;
  retentionReason: string | null;
  resource: ResourceSummary;
  size: number | null;
  status: ResourceBackupStatus;
}

export interface ResourceBackupScheduledOperationSummary {
  cleanedCount: number;
  lastCleanupAt: string | null;
  lastRunAt: string | null;
  lastStatus: ResourceBackupStatus | null;
  retention: CompartmentResourceOperationRetentionConfig | null;
  schedule: CompartmentResourceOperationScheduleConfig;
}

export interface ResourceBackupCreateResponse {
  backup: ResourceBackupSummary;
  environment: EnvironmentSummary;
  project: ProjectSummary;
}

export interface ResourceBackupListResponse {
  backups: ResourceBackupSummary[];
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resource: ResourceSummary;
  scheduledOperation: ResourceBackupScheduledOperationSummary | null;
}

export interface ResourceBackupShowResponse {
  backup: ResourceBackupSummary;
  environment: EnvironmentSummary;
  manifest: ResourceBackupManifest | null;
  project: ProjectSummary;
}

export interface ResourceRestoreRequest {
  backupId: string;
  confirmation?: ResourceRestoreConfirmation | undefined;
}

export interface ResourceRestoreAsRequest {
  targetResourceName: string;
}

export interface ResourceRestoreResponse {
  environment: EnvironmentSummary;
  preRestoreBackup: ResourceBackupSummary;
  project: ProjectSummary;
  resource: ResourceSummary;
  restoredBackup: ResourceBackupSummary;
  success: true;
}

export interface ResourceRestoreAsResponse {
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resource: ResourceSummary;
  restoredBackup: ResourceBackupSummary;
  success: true;
}

const resourceBackupStatusSchema: ContractSchema<ResourceBackupStatus> = z.enum([
  'running',
  'succeeded',
  'failed',
  'deleted',
]);
const resourceBackupPurposeSchema: ContractSchema<ResourceBackupPurpose> = z.enum([
  'manual',
  'pre_restore',
  'scheduled',
]);

export const resourceBackupShowQuerySchema: ContractSchema<ResourceBackupShowQuery> = z
  .object({
    backupId: z.string().min(1),
    environmentName: environmentNameSchema.optional(),
    projectName: compartmentProjectNameSchema,
  })
  .strict();

const resourceBackupSummarySchema: ContractSchema<ResourceBackupSummary> = z
  .object({
    artifactLocation: z.string().min(1).nullable(),
    checksum: z.string().min(1).nullable(),
    completedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    failureSummary: z.string().min(1).nullable(),
    id: z.string().min(1),
    purpose: resourceBackupPurposeSchema,
    retentionDeletedAt: z.string().datetime().nullable(),
    retentionReason: z.string().min(1).nullable(),
    resource: resourceSummarySchema,
    size: z.number().int().nonnegative().nullable(),
    status: resourceBackupStatusSchema,
  })
  .strict();

const resourceBackupScheduledOperationSummarySchema: ContractSchema<ResourceBackupScheduledOperationSummary> = z
  .object({
    cleanedCount: z.number().int().nonnegative(),
    lastCleanupAt: z.string().datetime().nullable(),
    lastRunAt: z.string().datetime().nullable(),
    lastStatus: resourceBackupStatusSchema.nullable(),
    retention: compartmentResourceOperationRetentionConfigSchema.nullable(),
    schedule: compartmentResourceOperationScheduleConfigSchema,
  })
  .strict();

export const resourceBackupCreateResponseSchema: ContractSchema<ResourceBackupCreateResponse> = z
  .object({
    backup: resourceBackupSummarySchema,
    environment: environmentSummarySchema,
    project: projectSummarySchema,
  })
  .strict();

export const resourceBackupListResponseSchema: ContractSchema<ResourceBackupListResponse> = z
  .object({
    backups: z.array(resourceBackupSummarySchema),
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resource: resourceSummarySchema,
    scheduledOperation: resourceBackupScheduledOperationSummarySchema.nullable(),
  })
  .strict();

const resourceBackupManifestSchema: ContractSchema<ResourceBackupManifest> = z
  .object({
    artifactLocation: z.string().min(1),
    backupId: z.string().min(1),
    checksum: z.string().min(1).nullable(),
    createdAt: z.string().datetime(),
    createdBy: z.string().min(1).nullable(),
    environment: environmentSummarySchema,
    failureSummary: z.string().min(1).nullable(),
    operationConfigHash: z.string().min(1),
    operationImage: z.string().min(1),
    project: projectSummarySchema,
    resource: resourceSummarySchema,
    resourceImage: z.string().min(1),
    resourceRuntimeDefinitionHash: z.string().min(1),
    size: z.number().int().nonnegative().nullable(),
    status: resourceBackupStatusSchema,
    volumes: z.array(resourceVolumeSummarySchema),
  })
  .strict();

export const resourceBackupShowResponseSchema: ContractSchema<ResourceBackupShowResponse> = z
  .object({
    backup: resourceBackupSummarySchema,
    environment: environmentSummarySchema,
    manifest: resourceBackupManifestSchema.nullable(),
    project: projectSummarySchema,
  })
  .strict();

export const resourceRestoreRequestSchema: ContractSchema<ResourceRestoreRequest> = z
  .object({
    backupId: z.string().min(1),
    confirmation: z.literal(resourceRestoreConfirmation).optional(),
  })
  .strict()
  .superRefine((request: ResourceRestoreRequest, context: z.RefinementCtx): void => {
    if (request.confirmation === resourceRestoreConfirmation) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Resource restore requires confirmation.',
      path: ['confirmation'],
    });
  });

export const resourceRestoreAsRequestSchema: ContractSchema<ResourceRestoreAsRequest> = z
  .object({
    targetResourceName: compartmentResourceNameSchema,
  })
  .strict();

export const resourceRestoreResponseSchema: ContractSchema<ResourceRestoreResponse> = z
  .object({
    environment: environmentSummarySchema,
    preRestoreBackup: resourceBackupSummarySchema,
    project: projectSummarySchema,
    resource: resourceSummarySchema,
    restoredBackup: resourceBackupSummarySchema,
    success: z.literal(true),
  })
  .strict();

export const resourceRestoreAsResponseSchema: ContractSchema<ResourceRestoreAsResponse> = z
  .object({
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resource: resourceSummarySchema,
    restoredBackup: resourceBackupSummarySchema,
    success: z.literal(true),
  })
  .strict();

export function buildCompartmentResourceBackupRestorePathname(backupId: string): string {
  return `${buildCompartmentResourceBackupShowPathname(backupId)}/restore`;
}

export function buildCompartmentResourceBackupShowPathname(backupId: string): string {
  return compartmentResourceBackupShowPathnameTemplate.replace(':backupId', encodeURIComponent(backupId));
}
