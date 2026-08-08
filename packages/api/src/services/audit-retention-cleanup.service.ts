import type { AuditRetentionEffectivePolicy } from '@compartment/contracts';
import type { ApiConfig } from '../config';
import { deleteExpiredAuditEventsBatch, listAuditRetentionCleanupCandidates } from '../queries/audit-events.query';
import type { AuditRetentionCleanupCandidateRow } from '../queries/audit-events.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
  buildConfiguredAuditRetentionPolicy,
  readInstanceAuditRetentionPolicy,
  resolveEffectiveAuditRetentionPolicy,
} from './audit-retention-policy.service';
import type {
  AuditRetentionBatchDeleteLoopInput,
  AuditRetentionCleanupLimits,
  AuditRetentionCleanupOrganizationResult,
  AuditRetentionCleanupResult,
} from './audit-retention-cleanup.service.types';

const dayMs: number = 24 * 60 * 60 * 1000;

export async function runAuditRetentionCleanup(): Promise<AuditRetentionCleanupResult> {
  const config: ApiConfig = getApiConfig();
  const limits: AuditRetentionCleanupLimits = readAuditRetentionCleanupLimits(config);
  const candidates: AuditRetentionCleanupCandidateRow[] = await listAuditRetentionCleanupCandidates();
  const instanceDefault: AuditRetentionEffectivePolicy = readInstanceAuditRetentionPolicy();
  const organizations: AuditRetentionCleanupOrganizationResult[] = [];

  for (const candidate of candidates) {
    organizations.push(await cleanupOrganizationAuditEvents(candidate, instanceDefault, limits));
  }

  return {
    deletedCount: sumDeletedAuditEvents(organizations),
    organizations,
  };
}

async function cleanupOrganizationAuditEvents(
  candidate: AuditRetentionCleanupCandidateRow,
  instanceDefault: AuditRetentionEffectivePolicy,
  limits: AuditRetentionCleanupLimits,
): Promise<AuditRetentionCleanupOrganizationResult> {
  const effectivePolicy: AuditRetentionEffectivePolicy = resolveCandidateAuditRetentionPolicy(
    candidate,
    instanceDefault,
  );
  if (effectivePolicy.mode === 'indefinite') {
    return buildAuditRetentionCleanupOrganizationResult(candidate, effectivePolicy, 0);
  }

  const occurredBefore: Date = buildAuditRetentionCutoff(effectivePolicy);
  const deletedCount: number = await deleteExpiredOrganizationAuditEvents(
    candidate.organizationId,
    occurredBefore,
    limits,
  );

  return buildAuditRetentionCleanupOrganizationResult(candidate, effectivePolicy, deletedCount);
}

function resolveCandidateAuditRetentionPolicy(
  candidate: AuditRetentionCleanupCandidateRow,
  instanceDefault: AuditRetentionEffectivePolicy,
): AuditRetentionEffectivePolicy {
  return resolveEffectiveAuditRetentionPolicy(buildConfiguredAuditRetentionPolicy(candidate), instanceDefault);
}

function buildAuditRetentionCleanupOrganizationResult(
  candidate: AuditRetentionCleanupCandidateRow,
  effectivePolicy: AuditRetentionEffectivePolicy,
  deletedCount: number,
): AuditRetentionCleanupOrganizationResult {
  return {
    deletedCount,
    effectivePolicy,
    organizationId: candidate.organizationId,
  };
}

async function deleteExpiredOrganizationAuditEvents(
  organizationId: string,
  occurredBefore: Date,
  limits: AuditRetentionCleanupLimits,
): Promise<number> {
  return await deleteExpiredRecordsInBatches({
    batchSize: limits.batchSize,
    deleteBatch: async (): Promise<number> =>
      await deleteExpiredAuditEventsBatch({
        limit: limits.batchSize,
        occurredBefore,
        organizationId,
      }),
    maxBatches: limits.maxBatches,
  });
}

async function deleteExpiredRecordsInBatches(input: AuditRetentionBatchDeleteLoopInput): Promise<number> {
  let deletedCount: number = 0;
  let batchCount: number = 0;
  let lastBatchDeletedCount: number = input.batchSize;

  while (lastBatchDeletedCount === input.batchSize && batchCount < input.maxBatches) {
    lastBatchDeletedCount = await input.deleteBatch();
    deletedCount += lastBatchDeletedCount;
    batchCount += 1;
  }

  return deletedCount;
}

function buildAuditRetentionCutoff(policy: AuditRetentionEffectivePolicy): Date {
  return new Date(Date.now() - requireAuditRetentionDays(policy) * dayMs);
}

function requireAuditRetentionDays(policy: AuditRetentionEffectivePolicy): number {
  if (policy.days === null) {
    throw new Error('Expected audit retention days.');
  }

  return policy.days;
}

function sumDeletedAuditEvents(results: readonly AuditRetentionCleanupOrganizationResult[]): number {
  return results.reduce(
    (total: number, result: AuditRetentionCleanupOrganizationResult): number => total + result.deletedCount,
    0,
  );
}

function readAuditRetentionCleanupLimits(config: ApiConfig): AuditRetentionCleanupLimits {
  return {
    batchSize: config.auditRetentionCleanupBatchSize,
    maxBatches: config.auditRetentionCleanupMaxBatches,
  };
}
