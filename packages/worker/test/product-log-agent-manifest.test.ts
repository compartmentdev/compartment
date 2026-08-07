import { describe, expect, it } from 'vitest';
import {
  readProductLogAgentDocuments,
  readProductLogAgentTemplate,
  readProductLogAgentVectorConfig,
} from './product-log-agent-chart.helpers';

describe('product log agent manifest', (): void => {
  it('keeps capture durable and every queue bounded', async (): Promise<void> => {
    const config: string = await readProductLogAgentVectorConfig();

    expect(config).toContain('offset_key: source_offset');
    expect(config).toContain('fingerprint:\n      strategy: checksum');
    expect(config).not.toContain('strategy: device_and_inode');
    expect(config).toContain('max_size: 268435488');
    expect(config).toContain('max_events: 200');
    expect(config).toContain('max_bytes: 786432');
    expect(config).toContain('retry_max_duration_secs: 30');
    expect(config).toContain('retry_attempts: 9223372036854775807');
    expect(config).toContain('inputs: [product_events, product_store_flush_event]');
    expect(config).toContain('condition: .name == "uptime_seconds"');
    expect(config).toContain('namespace": "compartment-log-buffer-flush"');
    expect(config).toContain('type: prometheus_exporter');
    expect(config).toContain('type: host_metrics');
    expect(config).toContain('when_full: block');
  });

  it('reads kubelet files without embedding credentials or a file sink', async (): Promise<void> => {
    const config: string = await readProductLogAgentVectorConfig();
    const template: string = await readProductLogAgentTemplate();

    expect(template).toContain('mountPath: /var/log/pods');
    expect(config).toContain('/var/log/pods/cpt-*/resource/*.log');
    expect(config).toContain('app(?:-[a-z0-9-]+)?|resource');
    expect(template).toContain('readOnly: true');
    expect(template).toContain('secretKeyRef:');
    expect(template).toContain('key: ingest-token');
    expect(template).not.toContain('runtime-control-token');
    expect(config).toContain('type: http');
    expect(config).not.toContain('payload_prefix');
    expect(config).not.toContain('compression: gzip');
    expect(config).not.toContain('type: file\n    inputs:');
  });

  it('ships the agent as a hardened DaemonSet with a bounded log budget', async (): Promise<void> => {
    const documents: object[] = await readProductLogAgentDocuments();
    const template: string = await readProductLogAgentTemplate();

    expect(documents).toHaveLength(5);
    expect(template).toMatch(/compartment\.dev\/log-slo-lines-per-second: ['"]12000['"]/u);
    expect(template).toContain('readOnlyRootFilesystem: true');
    expect(template).toContain('allowPrivilegeEscalation: false');
    expect(template).toContain('automountServiceAccountToken: false');
  });
});
