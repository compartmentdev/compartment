import { Gauge } from 'prom-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createPrometheusRegistry, startPrometheusMetricsServer } from '../src/prometheus-metrics';
import type { PrometheusMetricsServer } from '../src/prometheus-metrics.types';

let server: PrometheusMetricsServer | null = null;

afterEach(async (): Promise<void> => {
  if (server !== null) {
    await server.close();
  }
  server = null;
});

describe('Prometheus metrics server', (): void => {
  it('serves package metrics and standard process metrics only on the configured path', async (): Promise<void> => {
    const registry = createPrometheusRegistry('test-service');
    const gauge = new Gauge({
      help: 'Test metric.',
      name: 'compartment_test_value',
      registers: [registry],
    });
    gauge.set(7);
    server = await startPrometheusMetricsServer({ host: '127.0.0.1', port: 0, registry });

    const response: Response = await fetch(`http://127.0.0.1:${server.port}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const output: string = await response.text();
    expect(output).toContain('compartment_test_value 7');
    expect(output).toContain('compartment_process_cpu_seconds_total');
    expect(output).toContain('service="test-service"');

    expect((await fetch(`http://127.0.0.1:${server.port}/healthz`)).status).toBe(404);
  });
});
