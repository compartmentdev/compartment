import Fastify from 'fastify';
import pino from 'pino';
import { readNodeConfig, type NodeConfig } from './config';
import type { CreateNodeAppOptions, NodeApp } from './app.types';
import { registerNodeRoutes } from './routes/register-routes';
import { createRegisterNode } from './services/registration-api.service';
import type { RegisterNode } from './services/registration-api.types';
import { registerNodeOnStartup } from './services/startup-registration.service';
import { reconcileRuntimeNetworksOnStartup } from './services/startup-runtime-network.service';

const nodePluginTimeoutMs: number = 30_000;

export function createNodeApp({ config = readNodeConfig() }: CreateNodeAppOptions = {}): NodeApp {
  const logger: pino.Logger<never, boolean> = createNodeLogger(config);
  const app: NodeApp = Fastify({
    loggerInstance: logger,
    pluginTimeout: nodePluginTimeoutMs,
  });

  registerNodeRoutes(app, config);
  registerNodeLifecycle(app, config);

  return app;
}

function createNodeLogger(config: NodeConfig): pino.Logger<never, boolean> {
  return pino({
    level: config.logLevel,
    base: {
      service: 'node',
    },
  });
}

function registerNodeLifecycle(app: NodeApp, config: NodeConfig): void {
  const registerNode: RegisterNode = createRegisterNode({
    apiUrl: config.apiUrl,
    runtimeControlToken: config.runtimeControlToken,
  });

  app.addHook('onReady', createNodeReadyHook(app, config, registerNode));
}

function createNodeReadyHook(app: NodeApp, config: NodeConfig, registerNode: RegisterNode): () => Promise<void> {
  return async (): Promise<void> => {
    await reconcileRuntimeNetworksOnStartup(config, app.log);
    await registerNodeOnStartup(registerNode, config, app.log);
  };
}
