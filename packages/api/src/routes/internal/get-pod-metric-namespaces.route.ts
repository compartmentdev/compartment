import {
  buildFastifyResponseSchemas,
  workerListPodMetricNamespacesPathname,
  workerListPodMetricNamespacesResponseSchema,
  type WorkerListPodMetricNamespacesResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { readPodMetricNamespaceScope } from '../../services/pod-metrics-namespace.service';
import type { PodMetricNamespaceScope } from '../../services/pod-metrics-namespace.service.types';

export function registerGetPodMetricNamespacesRoute(app: ApiApp): void {
  app.get(
    workerListPodMetricNamespacesPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerListPodMetricNamespacesResponseSchema }) } },
    async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const scope: PodMetricNamespaceScope = await readPodMetricNamespaceScope();
      const response: WorkerListPodMetricNamespacesResponse = { namespaceIds: scope.namespaceIds };
      return await reply.send(workerListPodMetricNamespacesResponseSchema.parse(response));
    },
  );
}
