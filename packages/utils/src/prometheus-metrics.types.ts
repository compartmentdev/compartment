import type { Registry } from 'prom-client';

export interface PrometheusMetricsServer {
  port: number;
  close(): Promise<void>;
}

export interface PrometheusMetricsServerOptions {
  host: string;
  path?: string | undefined;
  port: number;
  registry: Registry;
}
