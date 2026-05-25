import type { AuditFileSinkConfig } from '../src/config';

export const defaultAuditFileSinkConfig: AuditFileSinkConfig = {
  directory: '/tmp/compartment-test-audit-logs',
  enabled: false,
  retentionFiles: 30,
  rotateInterval: '1d',
  rotateSize: '64M',
};
