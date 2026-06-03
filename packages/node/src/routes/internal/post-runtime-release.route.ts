import {
  buildFastifyResponseSchemas,
  nodeReleasePathname,
  nodeReleaseRequestSchema,
  nodeReleaseResponseSchema,
  type NodeReleaseRequest,
  type NodeReleaseResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import { releaseRuntimeContainer } from '../../services/runtime.service';
import type { RuntimeDeployConfig } from '../../services/runtime.types';

export function registerPostRuntimeReleaseRoute(app: NodeApp, config: NodeConfig): void {
  app.post(
    nodeReleasePathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeReleaseResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: NodeReleaseRequest = nodeReleaseRequestSchema.parse(request.body);
      const response: NodeReleaseResponse = nodeReleaseResponseSchema.parse(
        await releaseRuntimeContainer(input, buildRuntimeReleaseConfig(config)),
      );

      return await reply.send(response);
    },
  );
}

function buildRuntimeReleaseConfig(config: NodeConfig): RuntimeDeployConfig {
  return {
    appPortEnd: config.appPortEnd,
    appPortStart: config.appPortStart,
    dockerNamespace: config.dockerNamespace,
    runtimeConnectivityMode: config.runtimeConnectivityMode,
    runtimeDefaultUpstreamHost: config.runtimeDefaultUpstreamHost,
    runtimeNetworkPool: config.runtimeNetworkPool,
    runtimeRegistryCredentials: config.runtimeRegistryCredentials,
    runtimeProbeImageRef: config.runtimeProbeImageRef,
  };
}
