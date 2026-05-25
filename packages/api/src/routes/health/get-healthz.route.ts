import { healthResponseSchema, type HealthResponse } from '@compartment/contracts';
import type { ApiApp } from '../../app.types';

export function registerGetHealthzRoute(app: ApiApp): void {
  app.get(
    '/healthz',
    (): HealthResponse =>
      healthResponseSchema.parse({
        service: 'api',
        status: 'ok',
        timestamp: new Date().toISOString(),
      }),
  );
}
