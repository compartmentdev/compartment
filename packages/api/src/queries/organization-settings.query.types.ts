import type { AuditRetentionMode, RollbackRetentionMode } from '@compartment/contracts';

export type OrganizationRollbackRetentionSettingsMode = RollbackRetentionMode;
export type OrganizationAuditRetentionSettingsMode = AuditRetentionMode;

export interface OrganizationSettingsRow {
  auditRetentionDays: number | null;
  auditRetentionMode: OrganizationAuditRetentionSettingsMode;
  organizationId: string;
  rollbackRetentionLimit: number | null;
  rollbackRetentionMode: OrganizationRollbackRetentionSettingsMode;
}

export type OrganizationRollbackRetentionSettingsRow = Pick<
  OrganizationSettingsRow,
  'organizationId' | 'rollbackRetentionLimit' | 'rollbackRetentionMode'
>;

export type OrganizationAuditRetentionSettingsRow = Pick<
  OrganizationSettingsRow,
  'auditRetentionDays' | 'auditRetentionMode' | 'organizationId'
>;

export interface UpdateOrganizationSettingsInput {
  auditRetentionDays: number | null;
  auditRetentionMode: OrganizationAuditRetentionSettingsMode;
  organizationId: string;
  rollbackRetentionLimit: number | null;
  rollbackRetentionMode: OrganizationRollbackRetentionSettingsMode;
}
