import type { RollbackRetentionConfiguredPolicy, RollbackRetentionEffectivePolicy } from '@compartment/contracts';

export function formatRollbackRetentionPolicy(
  policy: RollbackRetentionConfiguredPolicy | RollbackRetentionEffectivePolicy,
): string {
  if (policy.mode === 'inherit' || policy.mode === 'indefinite') {
    return policy.mode;
  }

  return `keep last ${requireRollbackRetentionLimit(policy.limit)}`;
}

function requireRollbackRetentionLimit(limit: number | null): number {
  if (limit === null) {
    throw new Error('Expected rollback retention limit.');
  }

  return limit;
}
