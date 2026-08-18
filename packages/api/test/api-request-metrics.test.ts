import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { registerApiRequestMetrics } from '../src/http/api-request-metrics';

const mocks = vi.hoisted(() => ({ observe: vi.fn() }));

vi.mock('../src/services/platform-metrics.service', (): { observeApiHttpRequest: typeof mocks.observe } => ({
  observeApiHttpRequest: mocks.observe,
}));

let app: ApiApp | null = null;

afterEach(async (): Promise<void> => {
  mocks.observe.mockReset();
  if (app !== null) {
    await app.close();
  }
  app = null;
});

describe('API request metrics hook', (): void => {
  it('uses route templates and a fixed unmatched label', async (): Promise<void> => {
    app = Fastify({ loggerInstance: pino({ enabled: false }) });
    registerApiRequestMetrics(app);
    app.get(
      '/projects/:projectId',
      async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => await reply.send('ok'),
    );

    await app.inject({ method: 'GET', url: '/projects/prj_1' });
    await app.inject({ method: 'GET', url: '/missing' });

    expect(mocks.observe).toHaveBeenNthCalledWith(1, 'GET', '/projects/:projectId', 200, expect.any(Number));
    expect(mocks.observe).toHaveBeenNthCalledWith(2, 'GET', 'unmatched', 404, expect.any(Number));
  });
});
