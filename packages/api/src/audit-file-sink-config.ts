import { z } from 'zod';
import { resolveConfiguredPath } from './config-paths';

export interface AuditFileSinkConfigEnv {
  COMPARTMENT_AUDIT_FILE_SINK_DIR: string;
  COMPARTMENT_AUDIT_FILE_SINK_ENABLED: string;
  COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES: number;
  COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL: string;
  COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE: string;
}

export interface AuditFileSinkConfig {
  directory: string;
  enabled: boolean;
  retentionFiles: number;
  rotateInterval: string;
  rotateSize: string;
}

export const auditFileSinkConfigEnvSchema: z.ZodRawShape = {
  COMPARTMENT_AUDIT_FILE_SINK_DIR: z.string().min(1),
  COMPARTMENT_AUDIT_FILE_SINK_ENABLED: z.string().min(1),
  COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES: z.coerce.number().int().positive(),
  COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL: z.string().min(1),
  COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE: z.string().min(1),
};

export function readAuditFileSinkConfig(parsed: AuditFileSinkConfigEnv): AuditFileSinkConfig {
  return {
    directory: resolveConfiguredPath(parsed.COMPARTMENT_AUDIT_FILE_SINK_DIR),
    enabled: readRequiredBoolean(parsed.COMPARTMENT_AUDIT_FILE_SINK_ENABLED, 'COMPARTMENT_AUDIT_FILE_SINK_ENABLED'),
    retentionFiles: parsed.COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES,
    rotateInterval: readRequiredRotatingFileStreamInterval(
      parsed.COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL,
      'COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL',
    ),
    rotateSize: readRequiredRotatingFileStreamSize(
      parsed.COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE,
      'COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE',
    ),
  };
}

function readRequiredBoolean(value: string, variableName: string): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  throw new Error(`${variableName} must be true or false.`);
}

function readRequiredRotatingFileStreamInterval(value: string, variableName: string): string {
  if (/^(?:[1-9]\d*[dM]|(?:1|2|3|4|6|8|12|24)h|(?:1|2|3|4|5|6|10|12|15|20|30|60)[ms])$/u.test(value)) {
    return value;
  }

  throw new Error(`${variableName} must be a rotating-file-stream interval like 1d, 12h, or 30m.`);
}

function readRequiredRotatingFileStreamSize(value: string, variableName: string): string {
  if (/^[1-9]\d*[BKMG]$/u.test(value)) {
    return value;
  }

  throw new Error(`${variableName} must be a rotating-file-stream size like 64M.`);
}
