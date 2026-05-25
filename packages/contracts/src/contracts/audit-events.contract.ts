import { z } from 'zod';
import {
  listPageQuerySchema,
  listPaginationSchema,
  listPerPageQuerySchema,
  type ListPagination,
} from './list.contract';
import type { ContractSchema } from './schema.types';

export type AuditEventScopeType = 'installation' | 'organization';
export type AuditEventStatus = 'failed' | 'succeeded';
export type AuditEventActorType = 'automation' | 'system' | 'user';
export type AuditEventExportFormat = 'csv' | 'ndjson';
export type AuditEventMetadataValue = boolean | number | string | null;
export type AuditEventMetadata = Record<string, AuditEventMetadataValue>;
export type AuditEventType =
  | 'audit.export.created'
  | 'organization.assignment.created'
  | 'organization.assignment.deleted'
  | 'organization.auth_settings.updated'
  | 'organization.group.created'
  | 'organization.group.deleted'
  | 'organization.group.member_added'
  | 'organization.group.member_removed'
  | 'organization.group.updated'
  | 'organization.role.created'
  | 'organization.role.deleted'
  | 'organization.role.updated'
  | 'organization.settings.updated'
  | 'organization.sso_oidc_provider.created'
  | 'organization.sso_oidc_provider.deleted'
  | 'organization.sso_oidc_provider.updated'
  | 'organization.user.blocked'
  | 'organization.user.invited'
  | 'organization.user.password_reset_issued'
  | 'organization.user.removed'
  | 'organization.user.unblocked'
  | 'source.auto_deploy.queued'
  | 'source.auto_deploy.skipped'
  | 'source.binding.created'
  | 'source.connected'
  | 'source.descriptor.excluded'
  | 'source.descriptor.included'
  | 'source.disconnected'
  | 'source.upload.created'
  | 'source.push.received'
  | 'source.settings.updated'
  | 'source.sync.failed'
  | 'source.sync.requested'
  | 'source.sync.succeeded';

export interface AuditEventActorSummary {
  email: string | null;
  principalId: string | null;
  sessionId: string | null;
  sourceIp: string | null;
  transport: string | null;
  type: AuditEventActorType;
  userAgent: string | null;
}

export interface AuditEventTargetSummary {
  displayName: string | null;
  environmentId: string | null;
  id: string;
  projectId: string | null;
  serviceId: string | null;
  type: string;
}

export interface AuditEventSummary {
  actor: AuditEventActorSummary;
  eventType: AuditEventType;
  id: string;
  metadata: AuditEventMetadata;
  occurredAt: string;
  organizationId: string | null;
  scopeType: AuditEventScopeType;
  status: AuditEventStatus;
  target: AuditEventTargetSummary;
}

export interface AuditEventListQuery {
  actor?: string | undefined;
  eventType?: AuditEventType | undefined;
  from?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  project?: string | undefined;
  targetType?: string | undefined;
  to?: string | undefined;
}

export interface AuditEventExportQuery extends Omit<AuditEventListQuery, 'page' | 'perPage'> {
  format: AuditEventExportFormat;
}

export interface AuditEventListResponse {
  events: AuditEventSummary[];
  pagination: ListPagination;
}

interface AuditEventListQueryInput {
  actor?: string | undefined;
  eventType?: AuditEventType | undefined;
  from?: string | undefined;
  page?: number | string | undefined;
  perPage?: number | string | undefined;
  project?: string | undefined;
  targetType?: string | undefined;
  to?: string | undefined;
}

interface AuditEventExportQueryInput extends Omit<AuditEventListQueryInput, 'page' | 'perPage'> {
  format?: AuditEventExportFormat | undefined;
}

interface AuditEventFilterQueryShape {
  actor: z.ZodOptional<z.ZodString>;
  eventType: z.ZodOptional<ContractSchema<AuditEventType>>;
  from: z.ZodOptional<z.ZodString>;
  project: z.ZodOptional<z.ZodString>;
  targetType: z.ZodOptional<z.ZodString>;
  to: z.ZodOptional<z.ZodString>;
}

const auditEventScopeTypeValues: readonly [AuditEventScopeType, ...AuditEventScopeType[]] = [
  'installation',
  'organization',
];
const auditEventStatusValues: readonly [AuditEventStatus, ...AuditEventStatus[]] = ['failed', 'succeeded'];
const auditEventActorTypeValues: readonly [AuditEventActorType, ...AuditEventActorType[]] = [
  'automation',
  'system',
  'user',
];
export const auditEventTypeOptions: readonly [AuditEventType, ...AuditEventType[]] = [
  'audit.export.created',
  'organization.assignment.created',
  'organization.assignment.deleted',
  'organization.auth_settings.updated',
  'organization.group.created',
  'organization.group.deleted',
  'organization.group.member_added',
  'organization.group.member_removed',
  'organization.group.updated',
  'organization.role.created',
  'organization.role.deleted',
  'organization.role.updated',
  'organization.settings.updated',
  'organization.sso_oidc_provider.created',
  'organization.sso_oidc_provider.deleted',
  'organization.sso_oidc_provider.updated',
  'organization.user.blocked',
  'organization.user.invited',
  'organization.user.password_reset_issued',
  'organization.user.removed',
  'organization.user.unblocked',
  'source.auto_deploy.queued',
  'source.auto_deploy.skipped',
  'source.binding.created',
  'source.connected',
  'source.descriptor.excluded',
  'source.descriptor.included',
  'source.disconnected',
  'source.upload.created',
  'source.push.received',
  'source.settings.updated',
  'source.sync.failed',
  'source.sync.requested',
  'source.sync.succeeded',
];

export const auditEventTypeSchema: ContractSchema<AuditEventType> = z.enum(auditEventTypeOptions);
export const auditEventExportFormatSchema: ContractSchema<AuditEventExportFormat> = z.enum(['csv', 'ndjson']);

const auditEventMetadataValueSchema: ContractSchema<AuditEventMetadataValue> = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.null(),
]);
const auditEventMetadataSchema: ContractSchema<AuditEventMetadata> = z.record(auditEventMetadataValueSchema);
const auditEventActorSchema: ContractSchema<AuditEventActorSummary> = z
  .object({
    email: z.string().email().nullable(),
    principalId: z.string().min(1).nullable(),
    sessionId: z.string().min(1).nullable(),
    sourceIp: z.string().min(1).nullable(),
    transport: z.string().min(1).nullable(),
    type: z.enum(auditEventActorTypeValues),
    userAgent: z.string().min(1).nullable(),
  })
  .strict();
const auditEventTargetSchema: ContractSchema<AuditEventTargetSummary> = z
  .object({
    displayName: z.string().min(1).nullable(),
    environmentId: z.string().min(1).nullable(),
    id: z.string().min(1),
    projectId: z.string().min(1).nullable(),
    serviceId: z.string().min(1).nullable(),
    type: z.string().min(1),
  })
  .strict();
const auditEventSummarySchema: ContractSchema<AuditEventSummary> = z
  .object({
    actor: auditEventActorSchema,
    eventType: auditEventTypeSchema,
    id: z.string().min(1),
    metadata: auditEventMetadataSchema,
    occurredAt: z.string().datetime(),
    organizationId: z.string().min(1).nullable(),
    scopeType: z.enum(auditEventScopeTypeValues),
    status: z.enum(auditEventStatusValues),
    target: auditEventTargetSchema,
  })
  .strict();

const auditEventFilterQueryShape: AuditEventFilterQueryShape = {
  actor: z.string().min(1).optional(),
  eventType: auditEventTypeSchema.optional(),
  from: z.string().datetime().optional(),
  project: z.string().min(1).optional(),
  targetType: z.string().min(1).optional(),
  to: z.string().datetime().optional(),
};

export const auditEventListQuerySchema: z.ZodType<AuditEventListQuery, z.ZodTypeDef, AuditEventListQueryInput> = z
  .object({
    ...auditEventFilterQueryShape,
    page: listPageQuerySchema.optional(),
    perPage: listPerPageQuerySchema.optional(),
  })
  .strict()
  .superRefine(validateAuditEventTimeRange);

export const auditEventExportQuerySchema: z.ZodType<AuditEventExportQuery, z.ZodTypeDef, AuditEventExportQueryInput> = z
  .object({
    ...auditEventFilterQueryShape,
    format: auditEventExportFormatSchema.default('ndjson'),
  })
  .strict()
  .superRefine(validateAuditEventTimeRange);

export const auditEventListResponseSchema: ContractSchema<AuditEventListResponse> = z
  .object({
    events: z.array(auditEventSummarySchema),
    pagination: listPaginationSchema,
  })
  .strict();

function validateAuditEventTimeRange(query: Pick<AuditEventListQuery, 'from' | 'to'>, context: z.RefinementCtx): void {
  if (query.from === undefined || query.to === undefined) {
    return;
  }

  if (Date.parse(query.from) <= Date.parse(query.to)) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'from must be earlier than or equal to to',
    path: ['from'],
  });
}
