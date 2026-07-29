import {
  buildFastifyResponseSchemas,
  workerPublishPodMetricsPathname,
  workerPublishPodMetricsRequestSchema,
  type WorkerPublishPodMetricsRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { publishMeteredPodMetrics } from '../../services/usage-metering.service';

export function registerPostPodMetricsRoute(app: ApiApp): void {
  app.post(
    workerPublishPodMetricsPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerPublishPodMetricsRequestSchema }) } },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerPublishPodMetricsRequest = parseRequestValue(
        workerPublishPodMetricsRequestSchema,
        request.body,
        'invalid_worker_pod_metrics_request',
      );
      await publishMeteredPodMetrics(input);
      return await reply.send(workerPublishPodMetricsRequestSchema.parse(input));
    },
  );
}
