import type { AuditRetentionConfiguredPolicy, AuditRetentionEffectivePolicy } from '@compartment/contracts';
import { getApiConfig } from '../runtime/runtime-access';
import type { OrganizationAuditRetentionSettingsRow } from '../queries/organization-settings.query.types';

export function readInstanceAuditRetentionPolicy(): AuditRetentionEffectivePolicy {
  return {
    days: getApiConfig().auditRetentionDays,
    mode: 'keep_days',
  };
}

export function buildConfiguredAuditRetentionPolicy(
  settings: OrganizationAuditRetentionSettingsRow,
): AuditRetentionConfiguredPolicy {
  return {
    days: settings.auditRetentionDays,
    mode: settings.auditRetentionMode,
  };
}

export function resolveEffectiveAuditRetentionPolicy(
  configured: AuditRetentionConfiguredPolicy,
  instanceDefault: AuditRetentionEffectivePolicy = readInstanceAuditRetentionPolicy(),
): AuditRetentionEffectivePolicy {
  if (configured.mode === 'inherit') {
    return instanceDefault;
  }

  return configured.mode === 'indefinite'
    ? {
        days: null,
        mode: 'indefinite',
      }
    : {
        days: requireAuditRetentionDays(configured.days),
        mode: 'keep_days',
      };
}

function requireAuditRetentionDays(days: number | null): number {
  if (days === null) {
    throw new Error('Expected audit retention days.');
  }

  return days;
}
