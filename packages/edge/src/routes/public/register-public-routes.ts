import type { EdgeApp } from '../../app.types';
import { registerPublicIngressRoutes } from './register-public-ingress-routes';

export function registerPublicEdgeRoutes(app: EdgeApp): void {
  app.register(registerPublicIngressRoutes);
}
