import type { FastifyPluginOptions } from 'fastify';
import type { EdgeApp } from '../../app.types';
import { registerGetIngressAuthorizeRoute } from './get-ingress-authorize.route';
import { registerGetIngressRoute } from './get-ingress-route.route';
import { registerGetAppAccessCallbackRoute } from './get-app-access-callback.route';
import { registerPostAppAccessLogoutRoute } from './post-app-access-logout.route';

export function registerPublicIngressRoutes(
  app: EdgeApp,
  _options: FastifyPluginOptions,
  done: (err?: Error) => void,
): void {
  registerGetIngressRoute(app, app.edgeConfig, app.edgeStore);
  registerGetIngressAuthorizeRoute(app, app.edgeConfig, app.edgeStore);
  registerGetAppAccessCallbackRoute(app, app.edgeConfig, app.edgeStore);
  registerPostAppAccessLogoutRoute(app, app.edgeConfig, app.edgeStore);
  done();
}
