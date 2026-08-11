import { readAuditFileSinkConfig, type AuditFileSinkConfig } from './audit-file-sink-config';
import type { ApiConfigEnv } from './config-env.types';
import { readOptionalConfigText, readRequiredBoolean } from './config-value';
import { parseOptionalPositiveInt, readRequiredCronExpression } from './config-parsers';

export interface ApiRuntimeConfig {
  auditFileSink: AuditFileSinkConfig;
  auditRetentionCleanupBatchSize: number;
  auditRetentionCleanupCron: string;
  auditRetentionCleanupMaxBatches: number;
  auditRetentionDays: number;
  newProjectsPrivateByDefault: boolean;
  rollbackRetentionLimit: number | null;
  sourceArchiveDirectory: string;
  sourceArchiveMaxBytes: number;
  usageMeteringIntervalMs: number;
  usageRetentionDays: number;
  workerImageRef?: string | null;
}

export function readApiRuntimeConfig(parsed: ApiConfigEnv): ApiRuntimeConfig {
  return {
    auditFileSink: readAuditFileSinkConfig(parsed),
    auditRetentionCleanupBatchSize: parsed.COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE,
    auditRetentionCleanupCron: readRequiredCronExpression(
      parsed.COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON,
      'COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON',
    ),
    auditRetentionCleanupMaxBatches: parsed.COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES,
    auditRetentionDays: parsed.COMPARTMENT_AUDIT_RETENTION_DAYS,
    newProjectsPrivateByDefault: readRequiredBoolean(
      parsed.COMPARTMENT_NEW_PROJECTS_PRIVATE_BY_DEFAULT,
      'COMPARTMENT_NEW_PROJECTS_PRIVATE_BY_DEFAULT',
    ),
    rollbackRetentionLimit: parseOptionalPositiveInt(
      parsed.COMPARTMENT_ROLLBACK_RETENTION_LIMIT,
      'COMPARTMENT_ROLLBACK_RETENTION_LIMIT',
    ),
    sourceArchiveDirectory: parsed.COMPARTMENT_SOURCE_ARCHIVE_DIR,
    sourceArchiveMaxBytes: parsed.COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES,
    usageMeteringIntervalMs: parsed.COMPARTMENT_USAGE_METERING_INTERVAL_MS,
    usageRetentionDays: parsed.COMPARTMENT_USAGE_RETENTION_DAYS,
    workerImageRef: readOptionalConfigText(parsed.COMPARTMENT_WORKER_IMAGE),
  };
}
