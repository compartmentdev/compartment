import { PgBoss, type ScheduleOptions } from 'pg-boss';
import { runAuditRetentionCleanup } from '../services/audit-retention-cleanup.service';
import type { AuditRetentionCleanupResult } from '../services/audit-retention-cleanup.service.types';
import { runBrowserAuthTokenFlowCleanup } from '../services/browser-auth-token-flow-cleanup.service';
import type { BrowserAuthTokenFlowCleanupResult } from '../services/browser-auth-token-flow-cleanup.service.types';
import {
  auditRetentionCleanupDeleteAfterSeconds,
  auditRetentionCleanupExpireInSeconds,
  auditRetentionCleanupJobName,
  auditRetentionCleanupScheduleKey,
  auditRetentionCleanupScheduleSingletonSeconds,
  browserAuthTokenFlowCleanupCron,
  browserAuthTokenFlowCleanupDeleteAfterSeconds,
  browserAuthTokenFlowCleanupExpireInSeconds,
  browserAuthTokenFlowCleanupJobName,
  browserAuthTokenFlowCleanupScheduleKey,
  browserAuthTokenFlowCleanupScheduleSingletonSeconds,
} from './audit-jobs.constants';
import type {
  ApiJobsRuntime,
  AuditRetentionCleanupJobData,
  BrowserAuthTokenFlowCleanupJobData,
  StartApiJobsInput,
} from './api-jobs.types';

type LocalCronScheduleOptions = Omit<ScheduleOptions, 'tz'> & {
  tz: string | null;
};

class PgBossApiJobsRuntime implements ApiJobsRuntime {
  public constructor(private readonly boss: PgBoss) {}

  public async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }
}

export async function startApiJobs(input: StartApiJobsInput): Promise<ApiJobsRuntime> {
  const boss: PgBoss = createPgBoss(input);
  boss.on('error', (error: Error): void => {
    input.logger.error({ err: error }, 'API job queue error');
  });

  await boss.start();
  await createApiJobQueues(boss);
  await registerApiJobWorkers(boss);
  await scheduleAuditRetentionCleanup(boss, input.config.auditRetentionCleanupCron);
  await scheduleBrowserAuthTokenFlowCleanup(boss);

  return new PgBossApiJobsRuntime(boss);
}

function createPgBoss(input: StartApiJobsInput): PgBoss {
  return new PgBoss({
    application_name: 'compartment-api-jobs',
    connectionString: input.config.databaseUrl,
    max: 2,
  });
}

async function createApiJobQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(auditRetentionCleanupJobName, {
    deleteAfterSeconds: auditRetentionCleanupDeleteAfterSeconds,
    expireInSeconds: auditRetentionCleanupExpireInSeconds,
    policy: 'singleton',
    retryDelay: 300,
    retryLimit: 1,
  });
  await boss.createQueue(browserAuthTokenFlowCleanupJobName, {
    deleteAfterSeconds: browserAuthTokenFlowCleanupDeleteAfterSeconds,
    expireInSeconds: browserAuthTokenFlowCleanupExpireInSeconds,
    policy: 'singleton',
    retryDelay: 300,
    retryLimit: 1,
  });
}

async function registerApiJobWorkers(boss: PgBoss): Promise<void> {
  await boss.work<AuditRetentionCleanupJobData, AuditRetentionCleanupResult>(
    auditRetentionCleanupJobName,
    { localConcurrency: 1, pollingIntervalSeconds: 60 },
    async (): Promise<AuditRetentionCleanupResult> => await runAuditRetentionCleanup(),
  );
  await boss.work<BrowserAuthTokenFlowCleanupJobData, BrowserAuthTokenFlowCleanupResult>(
    browserAuthTokenFlowCleanupJobName,
    { localConcurrency: 1, pollingIntervalSeconds: 60 },
    async (): Promise<BrowserAuthTokenFlowCleanupResult> => await runBrowserAuthTokenFlowCleanup(),
  );
}

async function scheduleAuditRetentionCleanup(boss: PgBoss, cron: string): Promise<void> {
  const options: LocalCronScheduleOptions = {
    key: auditRetentionCleanupScheduleKey,
    singletonKey: auditRetentionCleanupScheduleKey,
    singletonSeconds: auditRetentionCleanupScheduleSingletonSeconds,
    tz: null,
  };

  await boss.schedule(
    auditRetentionCleanupJobName,
    cron,
    { requestedBy: 'schedule' } satisfies AuditRetentionCleanupJobData,
    options as ScheduleOptions,
  );
}

async function scheduleBrowserAuthTokenFlowCleanup(boss: PgBoss): Promise<void> {
  const options: LocalCronScheduleOptions = {
    key: browserAuthTokenFlowCleanupScheduleKey,
    singletonKey: browserAuthTokenFlowCleanupScheduleKey,
    singletonSeconds: browserAuthTokenFlowCleanupScheduleSingletonSeconds,
    tz: null,
  };

  await boss.schedule(
    browserAuthTokenFlowCleanupJobName,
    browserAuthTokenFlowCleanupCron,
    { requestedBy: 'schedule' } satisfies BrowserAuthTokenFlowCleanupJobData,
    options as ScheduleOptions,
  );
}
