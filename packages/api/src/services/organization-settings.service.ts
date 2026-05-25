import {
  auditRetentionConfiguredPolicySchema,
  auditRetentionEffectivePolicySchema,
  type AuditRetentionConfiguredPolicy,
  type AuditRetentionEffectivePolicy,
  rollbackRetentionConfiguredPolicySchema,
  rollbackRetentionEffectivePolicySchema,
  type RollbackRetentionConfiguredPolicy,
  type RollbackRetentionEffectivePolicy,
} from '@compartment/contracts';
import { insertOperationRecord } from '../queries/operations.query';
import {
  findOrganizationSettings,
  updateOrganizationSettings as persistOrganizationSettings,
} from '../queries/organization-settings.query';
import type { OrganizationSettingsRow } from '../queries/organization-settings.query.types';
import {
  buildConfiguredAuditRetentionPolicy,
  readInstanceAuditRetentionPolicy,
  resolveEffectiveAuditRetentionPolicy,
} from './audit-retention-policy.service';
import {
  buildConfiguredRollbackRetentionPolicy,
  readInstanceRollbackRetentionPolicy,
  resolveEffectiveRollbackRetentionPolicy,
} from './rollback-retention-policy.service';
import type {
  OrganizationAuditRetentionSettingsResult,
  OrganizationRollbackRetentionSettingsResult,
  OrganizationSettingsResult,
  UpdateOrganizationSettingsInput,
} from './organization-settings.service.types';

export async function readOrganizationSettings(organizationId: string): Promise<OrganizationSettingsResult> {
  return toOrganizationSettingsResult(await requireOrganizationSettings(organizationId));
}

export async function updateOrganizationSettings(
  input: UpdateOrganizationSettingsInput,
): Promise<OrganizationSettingsResult> {
  const currentSettings: OrganizationSettingsRow = await requireOrganizationSettings(input.organizationId);
  const settings: OrganizationSettingsRow = await persistUpdatedOrganizationSettings(input, currentSettings);

  await recordOrganizationSettingsUpdateOperation(input);

  return toOrganizationSettingsResult(settings);
}

export async function readOrganizationRollbackRetentionSettings(
  organizationId: string,
): Promise<OrganizationRollbackRetentionSettingsResult> {
  return toOrganizationRollbackRetentionSettingsResult(await requireOrganizationSettings(organizationId));
}

async function requireOrganizationSettings(organizationId: string): Promise<OrganizationSettingsRow> {
  const settings: OrganizationSettingsRow | undefined = await findOrganizationSettings(organizationId);
  if (settings === undefined) {
    throw new Error(`Organization settings for ${organizationId} were not found.`);
  }

  return settings;
}

async function persistUpdatedOrganizationSettings(
  input: UpdateOrganizationSettingsInput,
  currentSettings: OrganizationSettingsRow,
): Promise<OrganizationSettingsRow> {
  const rollbackRetention: RollbackRetentionConfiguredPolicy = readRollbackRetentionInput(input, currentSettings);
  const auditRetention: AuditRetentionConfiguredPolicy = readAuditRetentionInput(input, currentSettings);

  return await persistOrganizationSettings({
    auditRetentionDays: auditRetention.days,
    auditRetentionMode: auditRetention.mode,
    organizationId: input.organizationId,
    rollbackRetentionLimit: rollbackRetention.limit,
    rollbackRetentionMode: rollbackRetention.mode,
  });
}

async function recordOrganizationSettingsUpdateOperation(input: UpdateOrganizationSettingsInput): Promise<void> {
  await insertOperationRecord({
    actorPrincipalId: input.actorPrincipalId,
    completedAt: new Date(),
    status: 'succeeded',
    summary: `Updated organization settings for ${input.organizationSlug}`,
    targetId: input.organizationId,
    targetType: 'organization',
    type: 'organization.settings.update',
  });
}

function readRollbackRetentionInput(
  input: UpdateOrganizationSettingsInput,
  currentSettings: OrganizationSettingsRow,
): RollbackRetentionConfiguredPolicy {
  return (
    input.rollbackRetention ?? {
      limit: currentSettings.rollbackRetentionLimit,
      mode: currentSettings.rollbackRetentionMode,
    }
  );
}

function readAuditRetentionInput(
  input: UpdateOrganizationSettingsInput,
  currentSettings: OrganizationSettingsRow,
): AuditRetentionConfiguredPolicy {
  return (
    input.auditRetention ?? {
      days: currentSettings.auditRetentionDays,
      mode: currentSettings.auditRetentionMode,
    }
  );
}

function toOrganizationSettingsResult(settings: OrganizationSettingsRow): OrganizationSettingsResult {
  return {
    auditRetention: toOrganizationAuditRetentionSettingsResult(settings),
    rollbackRetention: toOrganizationRollbackRetentionSettingsResult(settings),
  };
}

function toOrganizationAuditRetentionSettingsResult(
  settings: OrganizationSettingsRow,
): OrganizationAuditRetentionSettingsResult {
  const configured: AuditRetentionConfiguredPolicy = auditRetentionConfiguredPolicySchema.parse(
    buildConfiguredAuditRetentionPolicy(settings),
  );
  const instanceDefault: AuditRetentionEffectivePolicy = auditRetentionEffectivePolicySchema.parse(
    readInstanceAuditRetentionPolicy(),
  );
  const effective: AuditRetentionEffectivePolicy = auditRetentionEffectivePolicySchema.parse(
    resolveEffectiveAuditRetentionPolicy(configured, instanceDefault),
  );

  return {
    configured,
    effective,
    instanceDefault,
  };
}

function toOrganizationRollbackRetentionSettingsResult(
  settings: OrganizationSettingsRow,
): OrganizationRollbackRetentionSettingsResult {
  const configured: RollbackRetentionConfiguredPolicy = rollbackRetentionConfiguredPolicySchema.parse(
    buildConfiguredRollbackRetentionPolicy(settings),
  );
  const instanceDefault: RollbackRetentionEffectivePolicy = rollbackRetentionEffectivePolicySchema.parse(
    readInstanceRollbackRetentionPolicy(),
  );
  const effective: RollbackRetentionEffectivePolicy = rollbackRetentionEffectivePolicySchema.parse(
    resolveEffectiveRollbackRetentionPolicy(configured, instanceDefault),
  );

  return {
    configured,
    effective,
    instanceDefault,
  };
}
