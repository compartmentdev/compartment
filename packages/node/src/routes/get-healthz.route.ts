import { buildFastifyResponseSchemas, healthResponseSchema, type HealthResponse } from '@compartment/contracts';
import type { NodeApp } from '../app.types';

export function registerGetHealthzRoute(app: NodeApp): void {
  app.get(
    '/healthz',
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: healthResponseSchema,
        }),
      },
    },
    (): HealthResponse =>
      healthResponseSchema.parse({
        service: 'node',
        status: 'ok',
        timestamp: new Date().toISOString(),
      }),
  );
}
