import type { FastifyPluginOptions } from 'fastify';
import type { EdgeApp } from '../../app.types';
import { authenticateInternalEdgeRequest } from './authenticate-internal-edge-request';
import { registerPostInvalidateAppSessionsRoute } from './post-invalidate-app-sessions.route';
import { registerGetEdgeMetricsRoute } from './get-edge-metrics.route';
import { registerPutAppAccessStateRoute } from './put-app-access-state.route';

export function registerInternalEdgeRoutes(
  app: EdgeApp,
  _options: FastifyPluginOptions,
  done: (err?: Error) => void,
): void {
  app.register(registerAuthenticatedInternalEdgeRoutes);
  done();
}

function registerAuthenticatedInternalEdgeRoutes(
  app: EdgeApp,
  _options: FastifyPluginOptions,
  done: (err?: Error) => void,
): void {
  app.addHook('preHandler', authenticateInternalEdgeRequest);
  registerGetEdgeMetricsRoute(app);
  registerPutAppAccessStateRoute(app, app.edgeStore);
  registerPostInvalidateAppSessionsRoute(app, app.edgeStore);
  done();
}
