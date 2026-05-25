import type { AuditRetentionConfiguredPolicy, AuditRetentionEffectivePolicy } from '@compartment/contracts';

export function formatAuditRetentionPolicy(
  policy: AuditRetentionConfiguredPolicy | AuditRetentionEffectivePolicy,
): string {
  if (policy.mode === 'inherit') {
    return 'inherit';
  }
  if (policy.mode === 'indefinite') {
    return 'indefinite';
  }

  return `keep ${requireAuditRetentionDays(policy.days)} days`;
}

function requireAuditRetentionDays(days: number | null): number {
  if (days === null) {
    throw new Error('Expected audit retention days.');
  }

  return days;
}
