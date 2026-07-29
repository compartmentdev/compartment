import type { FastifyBaseLogger } from 'fastify';
import type { ApiConfig } from '../config';

export interface ApiJobsRuntime {
  stop: () => Promise<void>;
}

export interface AuditRetentionCleanupJobData {
  requestedBy: 'schedule';
}

export interface BrowserAuthTokenFlowCleanupJobData {
  requestedBy: 'schedule';
}

export interface UsageRetentionCleanupJobData {
  requestedBy: 'schedule';
}

export interface StartApiJobsInput {
  config: ApiConfig;
  logger: FastifyBaseLogger;
}
