import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { collectDefaultMetrics, Registry } from 'prom-client';
import type { PrometheusMetricsServer, PrometheusMetricsServerOptions } from './prometheus-metrics.types';

export { Counter, Gauge, Histogram, Registry } from 'prom-client';
export type { PrometheusMetricsServer } from './prometheus-metrics.types';

const defaultMetricsPath: string = '/metrics';

export function createPrometheusRegistry(service: string): Registry {
  const registry: Registry = new Registry();
  collectDefaultMetrics({
    labels: { service },
    prefix: 'compartment_',
    register: registry,
  });
  return registry;
}

export async function startPrometheusMetricsServer(
  options: PrometheusMetricsServerOptions,
): Promise<PrometheusMetricsServer> {
  const path: string = options.path ?? defaultMetricsPath;
  const server: Server = createServer((request, response): void => {
    if (request.method !== 'GET' || request.url !== path) {
      response.writeHead(404).end();
      return;
    }
    void sendMetrics(options.registry, response);
  });
  await new Promise<void>((resolve, reject): void => {
    server.once('error', reject);
    server.listen(options.port, options.host, (): void => {
      server.off('error', reject);
      resolve();
    });
  });
  return new NodePrometheusMetricsServer(server, (server.address() as AddressInfo).port);
}

class NodePrometheusMetricsServer implements PrometheusMetricsServer {
  constructor(
    readonly server: Server,
    readonly port: number,
  ) {}

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject): void => {
      this.server.close((error?: Error): void => (error === undefined ? resolve() : reject(error)));
    });
  }
}

async function sendMetrics(registry: Registry, response: ServerResponse): Promise<void> {
  try {
    const metrics: string = await registry.metrics();
    response.writeHead(200, { 'content-type': registry.contentType });
    response.end(metrics);
  } catch {
    response.writeHead(500).end();
  }
}
