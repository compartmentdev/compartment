import type { ApiApp } from '../../app.types';
import { registerSystemDomainRoutes } from '../system-domain/register-system-domain-routes';
import { registerSystemPasswordResetRoutes } from './register-system-password-reset-routes';

export function registerSystemRoutes(app: ApiApp): void {
  app.register(registerSystemDomainRoutes);
  app.register(registerSystemPasswordResetRoutes);
}
