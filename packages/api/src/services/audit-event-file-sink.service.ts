import { chmodSync, mkdirSync } from 'node:fs';
import { createStream, type RotatingFileStream } from 'rotating-file-stream';
import type { AuditFileSinkConfig } from '../config';
import { toAuditEventsNdjson } from './audit-event-export-format.service';
import type {
  AuditEventFileSinkInitializationInput,
  AuditEventFileSinkRuntime,
  LocalAuditEventFileSinkPayload,
} from './audit-event-file-sink.service.types';

const auditEventFileSinkFilename: string = 'audit.ndjson';
const auditEventFileSinkHistoryFilename: string = 'audit.ndjson.history';
const auditEventFileMode: number = 0o600;
const auditEventDirectoryMode: number = 0o700;
let fileSinkRuntime: AuditEventFileSinkRuntime | null = null;

export function initializeAuditEventFileSink(input: AuditEventFileSinkInitializationInput): void {
  resetAuditEventFileSinkRuntime();

  if (!input.config.auditFileSink.enabled) {
    return;
  }

  ensurePrivateAuditEventFileSinkDirectory(input.config.auditFileSink.directory);
  const runtime: AuditEventFileSinkRuntime = {
    config: input.config.auditFileSink,
    logger: input.logger,
    stream: createAuditEventFileSinkStream(input.config.auditFileSink),
  };
  registerAuditEventFileSinkStreamHandlers(runtime);
  fileSinkRuntime = runtime;
}

function ensurePrivateAuditEventFileSinkDirectory(directory: string): void {
  mkdirSync(directory, { mode: auditEventDirectoryMode, recursive: true });
  chmodSync(directory, auditEventDirectoryMode);
}

export function writeAuditEventToLocalFileSink(event: LocalAuditEventFileSinkPayload): void {
  const runtime: AuditEventFileSinkRuntime | null = fileSinkRuntime;
  if (runtime === null) {
    return;
  }

  try {
    runtime.stream.write(`${toAuditEventsNdjson([event])}\n`, 'utf8', (error: Error | null | undefined): void => {
      if (error !== null && error !== undefined) {
        runtime.logger.warn({ err: error }, 'Failed to write audit event to local file sink');
      }
    });
  } catch (error) {
    const normalizedError: Error = error instanceof Error ? error : new Error(String(error));
    runtime.logger.warn({ err: normalizedError }, 'Failed to queue audit event for local file sink');
  }
}

export async function closeAuditEventFileSink(): Promise<void> {
  const runtime: AuditEventFileSinkRuntime | null = fileSinkRuntime;
  if (runtime === null) {
    return;
  }

  fileSinkRuntime = null;
  await endAuditEventFileSink(runtime);
}

async function endAuditEventFileSink(runtime: AuditEventFileSinkRuntime): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    runtime.stream.end((): void => {
      resolve();
    });
  });
}

function createAuditEventFileSinkStream(config: AuditFileSinkConfig): RotatingFileStream {
  return createStream(auditEventFileSinkFilename, {
    compress: 'gzip',
    encoding: 'utf8',
    history: auditEventFileSinkHistoryFilename,
    interval: config.rotateInterval,
    maxFiles: config.retentionFiles,
    mode: auditEventFileMode,
    path: config.directory,
    size: config.rotateSize,
  });
}

function registerAuditEventFileSinkStreamHandlers(runtime: AuditEventFileSinkRuntime): void {
  runtime.stream.on('error', (error: Error): void => {
    runtime.logger.warn({ err: error }, 'Audit file sink stream error');
  });
  runtime.stream.on('warning', (error: Error): void => {
    runtime.logger.warn({ err: error }, 'Audit file sink stream warning');
  });
}

function resetAuditEventFileSinkRuntime(): void {
  const runtime: AuditEventFileSinkRuntime | null = fileSinkRuntime;
  if (runtime === null) {
    return;
  }

  fileSinkRuntime = null;
  runtime.stream.end();
}
