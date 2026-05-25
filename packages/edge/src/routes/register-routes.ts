import type { EdgeApp } from '../app.types';
import { registerGetHealthzRoute } from './get-healthz.route';
import { registerInternalEdgeRoutes } from './internal/register-internal-routes';
import { registerPublicEdgeRoutes } from './public/register-public-routes';

export function registerEdgeRoutes(app: EdgeApp): void {
  registerGetHealthzRoute(app);
  app.register(registerInternalEdgeRoutes);
  registerPublicEdgeRoutes(app);
}
