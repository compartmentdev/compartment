import { z } from 'zod';
import {
  auditRetentionConfiguredPolicySchema,
  auditRetentionEffectivePolicySchema,
  type AuditRetentionConfiguredPolicy,
  type AuditRetentionEffectivePolicy,
} from './audit-retention.contract';
import type { ContractSchema } from './schema.types';
import {
  rollbackRetentionConfiguredPolicySchema,
  rollbackRetentionEffectivePolicySchema,
  type RollbackRetentionConfiguredPolicy,
  type RollbackRetentionEffectivePolicy,
} from './rollback-retention.contract';

export interface OrganizationSettingsRollbackRetentionSummary {
  configured: RollbackRetentionConfiguredPolicy;
  effective: RollbackRetentionEffectivePolicy;
  instanceDefault: RollbackRetentionEffectivePolicy;
}

export interface OrganizationSettingsAuditRetentionSummary {
  configured: AuditRetentionConfiguredPolicy;
  effective: AuditRetentionEffectivePolicy;
  instanceDefault: AuditRetentionEffectivePolicy;
}

export interface OrganizationSettingsSummary {
  auditRetention: OrganizationSettingsAuditRetentionSummary;
  rollbackRetention: OrganizationSettingsRollbackRetentionSummary;
}

export interface OrganizationSettingsResponse {
  settings: OrganizationSettingsSummary;
}

export interface UpdateOrganizationSettingsRequest {
  auditRetention?: AuditRetentionConfiguredPolicy | undefined;
  rollbackRetention?: RollbackRetentionConfiguredPolicy | undefined;
}

const organizationSettingsRollbackRetentionSummarySchema: ContractSchema<OrganizationSettingsRollbackRetentionSummary> =
  z
    .object({
      configured: rollbackRetentionConfiguredPolicySchema,
      effective: rollbackRetentionEffectivePolicySchema,
      instanceDefault: rollbackRetentionEffectivePolicySchema,
    })
    .strict();

const organizationSettingsAuditRetentionSummarySchema: ContractSchema<OrganizationSettingsAuditRetentionSummary> = z
  .object({
    configured: auditRetentionConfiguredPolicySchema,
    effective: auditRetentionEffectivePolicySchema,
    instanceDefault: auditRetentionEffectivePolicySchema,
  })
  .strict();

const organizationSettingsSummarySchema: ContractSchema<OrganizationSettingsSummary> = z
  .object({
    auditRetention: organizationSettingsAuditRetentionSummarySchema,
    rollbackRetention: organizationSettingsRollbackRetentionSummarySchema,
  })
  .strict();

export const organizationSettingsResponseSchema: ContractSchema<OrganizationSettingsResponse> = z
  .object({
    settings: organizationSettingsSummarySchema,
  })
  .strict();

export const updateOrganizationSettingsRequestSchema: ContractSchema<UpdateOrganizationSettingsRequest> = z
  .object({
    auditRetention: auditRetentionConfiguredPolicySchema.optional(),
    rollbackRetention: rollbackRetentionConfiguredPolicySchema.optional(),
  })
  .strict()
  .superRefine(validateOrganizationSettingsUpdate);

function validateOrganizationSettingsUpdate(
  request: UpdateOrganizationSettingsRequest,
  context: z.RefinementCtx,
): void {
  if (request.auditRetention !== undefined || request.rollbackRetention !== undefined) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'at least one organization setting is required',
  });
}
