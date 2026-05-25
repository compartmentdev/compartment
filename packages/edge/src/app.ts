import Fastify from 'fastify';
import pino from 'pino';
import { readEdgeConfig } from './config';
import type { CreateEdgeAppOptions, EdgeApp } from './app.types';
import { registerEdgeRoutes } from './routes/register-routes';
import { createEdgeAppAccessStateStore } from './services/app-access-state-store.service';
import { startEdgeAccessStateRefreshLoop } from './services/edge-bootstrap.service';
import { clearEdgeRuntime, configureEdgeRuntime } from './runtime/runtime';

export function createEdgeApp({ config = readEdgeConfig() }: CreateEdgeAppOptions = {}): EdgeApp {
  const app: EdgeApp = Fastify({
    loggerInstance: createEdgeLogger(config.logLevel),
  });
  app.decorate('edgeConfig', config);
  app.decorate('edgeStore', createEdgeAppAccessStateStore());
  configureEdgeRuntime(config);
  registerEdgeRoutes(app);
  let stopEdgeAccessStateRefreshLoop: () => void = (): void => undefined;
  app.addHook('onReady', (): void => {
    stopEdgeAccessStateRefreshLoop = startEdgeAccessStateRefreshLoop(config, app.edgeStore, app.log);
  });
  app.addHook('onClose', (): void => {
    stopEdgeAccessStateRefreshLoop();
    clearEdgeRuntime();
  });

  return app;
}

function createEdgeLogger(logLevel: string): pino.Logger<never, boolean> {
  return pino({
    level: logLevel,
    base: {
      service: 'edge',
    },
  });
}
