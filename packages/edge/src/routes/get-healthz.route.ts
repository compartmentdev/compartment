import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EdgeApp } from '../app.types';

export function registerGetHealthzRoute(app: EdgeApp): void {
  app.get('/healthz', async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    return await reply.code(200).send({
      service: 'edge',
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });
}
