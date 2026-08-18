import { createEdgeApp } from './app';
import { readEdgeConfig, type EdgeConfig } from './config';
import type { EdgeApp } from './app.types';
import { bootstrapEdgeAccessStateUntilReady } from './services/edge-bootstrap.service';
import { startPrometheusMetricsServer, type PrometheusMetricsServer } from '@compartment/utils';

async function startServer(): Promise<void> {
  const config: EdgeConfig = readEdgeConfig();
  const app: EdgeApp = createEdgeApp({ config });
  try {
    await bootstrapEdgeAccessStateUntilReady(config, app.edgeStore, app.edgeSnapshotMetrics, app.log);
    const metricsServer: PrometheusMetricsServer = await startPrometheusMetricsServer({
      host: config.bindHost,
      port: config.metricsPort,
      registry: app.edgeSnapshotMetrics.registry,
    });
    app.addHook('onClose', async (): Promise<void> => await metricsServer.close());
    const address: string = await app.listen({
      host: config.bindHost,
      port: config.port,
    });
    app.log.info({ address }, 'Edge server started.');
  } catch (error) {
    await app.close();
    throw error;
  }
}

void startServer();
