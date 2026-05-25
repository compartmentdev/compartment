import type {
  AuditRetentionConfiguredPolicy,
  AuditRetentionEffectivePolicy,
  OrganizationSettingsSummary,
  RollbackRetentionConfiguredPolicy,
  RollbackRetentionEffectivePolicy,
} from '@compartment/contracts';

export type OrganizationSettingsResult = OrganizationSettingsSummary;

export interface UpdateOrganizationSettingsInput {
  actorPrincipalId: string;
  auditRetention?: AuditRetentionConfiguredPolicy | undefined;
  organizationId: string;
  organizationSlug: string;
  rollbackRetention?: RollbackRetentionConfiguredPolicy | undefined;
}

export interface OrganizationRollbackRetentionSettingsResult {
  configured: RollbackRetentionConfiguredPolicy;
  effective: RollbackRetentionEffectivePolicy;
  instanceDefault: RollbackRetentionEffectivePolicy;
}

export interface OrganizationAuditRetentionSettingsResult {
  configured: AuditRetentionConfiguredPolicy;
  effective: AuditRetentionEffectivePolicy;
  instanceDefault: AuditRetentionEffectivePolicy;
}
