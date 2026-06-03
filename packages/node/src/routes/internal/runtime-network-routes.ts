import {
  buildFastifyResponseSchemas,
  nodeRuntimeNetworkReservationCleanupPathname,
  nodeRuntimeNetworkReservationCleanupRequestSchema,
  nodeRuntimeNetworkReservationCleanupResponseSchema,
  nodeRuntimeNetworkReservationPathname,
  nodeRuntimeNetworkReservationRequestSchema,
  nodeRuntimeNetworkReservationResponseSchema,
  type NodeRuntimeNetworkReservationCleanupRequest,
  type NodeRuntimeNetworkReservationCleanupResponse,
  type NodeRuntimeNetworkReservationRequest,
  type NodeRuntimeNetworkReservationResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import {
  cleanupRuntimeNetworkReservation,
  reserveRuntimeNetworksForDeployment,
} from '../../services/runtime-network-capacity.service';

export function registerRuntimeNetworkRoutes(app: NodeApp, config: NodeConfig): void {
  registerRuntimeNetworkReservationRoute(app, config);
  registerRuntimeNetworkReservationCleanupRoute(app, config);
}

function registerRuntimeNetworkReservationRoute(app: NodeApp, config: NodeConfig): void {
  app.post(
    nodeRuntimeNetworkReservationPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeRuntimeNetworkReservationResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: NodeRuntimeNetworkReservationRequest = nodeRuntimeNetworkReservationRequestSchema.parse(
        request.body,
      );
      const response: NodeRuntimeNetworkReservationResponse = nodeRuntimeNetworkReservationResponseSchema.parse(
        await reserveRuntimeNetworksForDeployment(input, config),
      );

      return await reply.send(response);
    },
  );
}

function registerRuntimeNetworkReservationCleanupRoute(app: NodeApp, config: NodeConfig): void {
  app.post(
    nodeRuntimeNetworkReservationCleanupPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeRuntimeNetworkReservationCleanupResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: NodeRuntimeNetworkReservationCleanupRequest =
        nodeRuntimeNetworkReservationCleanupRequestSchema.parse(request.body);
      const response: NodeRuntimeNetworkReservationCleanupResponse =
        nodeRuntimeNetworkReservationCleanupResponseSchema.parse(await cleanupRuntimeNetworkReservation(input, config));

      return await reply.send(response);
    },
  );
}
