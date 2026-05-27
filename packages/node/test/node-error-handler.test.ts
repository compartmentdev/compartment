import Fastify, { type LightMyRequestResponse } from 'fastify';
import {
  errorResponseSchema,
  nodeRuntimeResourceReadinessFailedErrorCode,
  type ErrorResponse,
} from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import type { NodeApp } from '../src/app.types';
import { createRuntimeResourceReadinessError } from '../src/errors/node-runtime-error';
import { registerNodeErrorHandler } from '../src/routes/node-error-handler';

describe('node error handler', (): void => {
  it('surfaces expected runtime resource readiness failures', async (): Promise<void> => {
    const app: NodeApp = createTestApp();
    app.post('/test/runtime-error', (): void => {
      throw createRuntimeResourceReadinessError({
        phase: 'startup',
        resourceName: 'postgres',
        timeoutMs: 30000,
      });
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/test/runtime-error',
      });
      const payload: ErrorResponse = errorResponseSchema.parse(response.json());

      expect(response.statusCode).toBe(500);
      expect(payload.error).toEqual({
        code: nodeRuntimeResourceReadinessFailedErrorCode,
        message: 'Resource postgres did not become ready before 30000ms.',
      });
    } finally {
      await app.close();
    }
  });

  it('keeps unexpected runtime errors generic', async (): Promise<void> => {
    const app: NodeApp = createTestApp();
    app.post('/test/unexpected-error', (): void => {
      throw new Error('unexpected runtime detail');
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/test/unexpected-error',
      });
      const payload: ErrorResponse = errorResponseSchema.parse(response.json());

      expect(response.statusCode).toBe(500);
      expect(payload.error).toEqual({
        code: 'internal_error',
        message: 'An unexpected error occurred.',
      });
    } finally {
      await app.close();
    }
  });
});

function createTestApp(): NodeApp {
  const app: NodeApp = Fastify();
  registerNodeErrorHandler(app);
  return app;
}
