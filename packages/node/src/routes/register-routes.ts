import type { NodeApp } from '../app.types';
import type { NodeConfig } from '../config';
import { registerGetHealthzRoute } from './get-healthz.route';
import { registerInternalNodeRoutes } from './internal/register-internal-routes';
import { registerNodeErrorHandler } from './node-error-handler';

export function registerNodeRoutes(app: NodeApp, config: NodeConfig): void {
  registerNodeErrorHandler(app);
  registerGetHealthzRoute(app);
  registerInternalNodeRoutes(app, config);
}
