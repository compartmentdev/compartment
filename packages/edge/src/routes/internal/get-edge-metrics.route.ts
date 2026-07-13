import type { EdgeApp } from '../../app.types';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function registerGetEdgeMetricsRoute(app: EdgeApp): void {
  app.get('/internal/metrics', async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await reply.type('text/plain; version=0.0.4; charset=utf-8').send(app.edgeSnapshotMetrics.render());
  });
}
