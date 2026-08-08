import type { AuditRetentionEffectivePolicy } from '@compartment/contracts';

export interface AuditRetentionCleanupOrganizationResult {
  deletedCount: number;
  effectivePolicy: AuditRetentionEffectivePolicy;
  organizationId: string;
}

export interface AuditRetentionCleanupLimits {
  batchSize: number;
  maxBatches: number;
}

export interface AuditRetentionCleanupResult {
  deletedCount: number;
  organizations: AuditRetentionCleanupOrganizationResult[];
}

export type AuditRetentionBatchDeleteHandler = () => Promise<number>;

export interface AuditRetentionBatchDeleteLoopInput {
  batchSize: number;
  deleteBatch: AuditRetentionBatchDeleteHandler;
  maxBatches: number;
}
