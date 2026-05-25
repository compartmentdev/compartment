import { healthResponseSchema, type HealthResponse } from '@compartment/contracts';
import type { ApiApp } from '../../app.types';

export function registerGetReadyzRoute(app: ApiApp): void {
  app.get(
    '/readyz',
    (): HealthResponse =>
      healthResponseSchema.parse({
        service: 'api',
        status: 'ok',
        timestamp: new Date().toISOString(),
      }),
  );
}
