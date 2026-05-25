import type { RollbackRetentionConfiguredPolicy, RollbackRetentionEffectivePolicy } from '@compartment/contracts';
import { getApiConfig } from '../runtime/runtime-access';
import type { OrganizationRollbackRetentionSettingsRow } from '../queries/organization-settings.query.types';

export function readInstanceRollbackRetentionPolicy(): RollbackRetentionEffectivePolicy {
  const limit: number | null = getApiConfig().rollbackRetentionLimit;

  return limit === null
    ? {
        limit: null,
        mode: 'indefinite',
      }
    : {
        limit,
        mode: 'keep_last',
      };
}

export function buildConfiguredRollbackRetentionPolicy(
  settings: OrganizationRollbackRetentionSettingsRow,
): RollbackRetentionConfiguredPolicy {
  return {
    limit: settings.rollbackRetentionLimit,
    mode: settings.rollbackRetentionMode,
  };
}

export function resolveEffectiveRollbackRetentionPolicy(
  configured: RollbackRetentionConfiguredPolicy,
  instanceDefault: RollbackRetentionEffectivePolicy = readInstanceRollbackRetentionPolicy(),
): RollbackRetentionEffectivePolicy {
  if (configured.mode === 'inherit') {
    return instanceDefault;
  }

  return configured.mode === 'indefinite'
    ? {
        limit: null,
        mode: 'indefinite',
      }
    : {
        limit: requireRollbackRetentionLimit(configured.limit),
        mode: 'keep_last',
      };
}

function requireRollbackRetentionLimit(limit: number | null): number {
  if (limit === null) {
    throw new Error('Expected rollback retention limit.');
  }

  return limit;
}
