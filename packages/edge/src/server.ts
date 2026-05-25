import { createEdgeApp } from './app';
import { readEdgeConfig, type EdgeConfig } from './config';
import type { EdgeApp } from './app.types';
import { bootstrapEdgeAccessStateUntilReady } from './services/edge-bootstrap.service';

async function startServer(): Promise<void> {
  const config: EdgeConfig = readEdgeConfig();
  const app: EdgeApp = createEdgeApp({ config });
  await bootstrapEdgeAccessStateUntilReady(config, app.edgeStore, app.log);
  const address: string = await app.listen({
    host: config.bindHost,
    port: config.port,
  });
  app.log.info({ address }, 'Edge server started.');
}

void startServer();
