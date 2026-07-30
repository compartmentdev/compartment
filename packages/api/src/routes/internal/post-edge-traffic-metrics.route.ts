import {
  buildFastifyResponseSchemas,
  edgePublishTrafficMetricsPathname,
  edgePublishTrafficMetricsRequestSchema,
  edgePublishTrafficMetricsResponseSchema,
  type EdgePublishTrafficMetricsRequest,
  type EdgePublishTrafficMetricsResponse,
  type EdgeTrafficMetric,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { publishEdgeTrafficMetrics } from '../../services/usage-metering.service';
import type {
  PublishEdgeTrafficMetricInput,
  PublishEdgeTrafficMetricsInput,
  PublishEdgeTrafficMetricsResult,
} from '../../services/usage-metering.service.types';

export function registerPostEdgeTrafficMetricsRoute(app: ApiApp): void {
  app.post(
    edgePublishTrafficMetricsPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: edgePublishTrafficMetricsResponseSchema }) } },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: EdgePublishTrafficMetricsRequest = parseRequestValue(
        edgePublishTrafficMetricsRequestSchema,
        request.body,
        'invalid_edge_traffic_metrics_request',
      );
      const result: PublishEdgeTrafficMetricsResult = await publishEdgeTrafficMetrics(toServiceInput(input));
      const response: EdgePublishTrafficMetricsResponse = {
        status: result,
      };
      return await reply.send(edgePublishTrafficMetricsResponseSchema.parse(response));
    },
  );
}

function toServiceInput(input: EdgePublishTrafficMetricsRequest): PublishEdgeTrafficMetricsInput {
  return {
    batchId: input.batchId,
    metrics: input.metrics.map(
      (metric: EdgeTrafficMetric): PublishEdgeTrafficMetricInput => ({
        observedAt: new Date(metric.observedAt),
        requestBytes: metric.requestBytes,
        requestCount: metric.requestCount,
        responseBytes: metric.responseBytes,
        status4xxCount: metric.status4xxCount,
        status5xxCount: metric.status5xxCount,
        upstreamHost: metric.upstreamHost,
      }),
    ),
    sourceId: input.sourceId,
  };
}
