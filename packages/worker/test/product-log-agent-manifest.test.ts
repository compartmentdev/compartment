import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseAllDocuments, type Document } from 'yaml';
import { describe, expect, it } from 'vitest';

const manifestPath: string = resolve(__dirname, '../manifests/product-log-agent.yaml');
const workerObservabilityRbacPath: string = resolve(__dirname, '../manifests/worker-observability-rbac.yaml');

describe('product log agent manifest', (): void => {
  it('keeps capture durable and every queue bounded', async (): Promise<void> => {
    const manifest: string = await readFile(manifestPath, 'utf8');
    const documents: object[] = parseAllDocuments(manifest).map(
      (document: Document): object => document.toJSON() as object,
    );

    expect(documents).toHaveLength(4);
    expect(manifest).toContain('offset_key: source_offset');
    expect(manifest).toContain('path: /var/lib/compartment/log-agent');
    expect(manifest).toContain('max_size: 268435488');
    expect(manifest).toContain('max_events: 200');
    expect(manifest).toContain('max_bytes: 786432');
    expect(manifest).toContain('retry_max_duration_secs: 30');
    expect(manifest).toContain('retry_attempts: 9223372036854775807');
    expect(manifest).toContain('type: prometheus_exporter');
    expect(manifest).toContain('type: host_metrics');
    expect(manifest).toMatch(/compartment\.dev\/log-slo-lines-per-second: ['"]12000['"]/);
    expect(manifest).toContain('ephemeral-storage: 384Mi');
    expect(manifest).toContain('when_full: block');
  });

  it('grants only cluster-wide Pod and metrics reads to the worker identity', async (): Promise<void> => {
    const manifest: string = await readFile(workerObservabilityRbacPath, 'utf8');
    const documents: object[] = parseAllDocuments(manifest).map(
      (document: Document): object => document.toJSON() as object,
    );

    expect(documents).toHaveLength(3);
    expect(manifest).toContain("apiGroups: ['metrics.k8s.io']");
    expect(manifest).toContain("resources: ['pods']");
    expect(manifest).toContain("verbs: ['get', 'list']");
    expect(manifest).not.toContain('watch');
    expect(manifest).not.toContain('create');
    expect(manifest).not.toContain('delete');
  });

  it('reads kubelet files without embedding credentials or a file sink', async (): Promise<void> => {
    const manifest: string = await readFile(manifestPath, 'utf8');

    expect(manifest).toContain('mountPath: /var/log/pods');
    expect(manifest).toContain('/var/log/pods/cpt-*/resource/*.log');
    expect(manifest).toContain('app(?:-[a-z0-9-]+)?|resource');
    expect(manifest).toContain('readOnly: true');
    expect(manifest).toContain('secretKeyRef:');
    expect(manifest).toContain('key: ingest-token');
    expect(manifest).not.toContain('runtime-control-token');
    expect(manifest).toContain('type: http');
    expect(manifest).not.toContain('payload_prefix');
    expect(manifest).not.toContain('compression: gzip');
    expect(manifest).not.toContain('type: file\n        inputs:');
  });
});
