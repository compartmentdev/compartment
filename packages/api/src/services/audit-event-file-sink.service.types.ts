import type { AuditEventSummary } from '@compartment/contracts';
import type { RotatingFileStream } from 'rotating-file-stream';
import type { ApiConfig, AuditFileSinkConfig } from '../config';

export interface AuditEventFileSinkInitializationInput {
  config: ApiConfig;
  logger: AuditEventFileSinkLogger;
}

export interface AuditEventFileSinkLogContext {
  err: Error;
}

export interface AuditEventFileSinkLogger {
  warn: (context: AuditEventFileSinkLogContext, message: string) => void;
}

export interface AuditEventFileSinkRuntime {
  config: AuditFileSinkConfig;
  logger: AuditEventFileSinkLogger;
  stream: RotatingFileStream;
}

export type LocalAuditEventFileSinkPayload = AuditEventSummary;
