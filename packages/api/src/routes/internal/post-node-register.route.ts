import {
  buildFastifyResponseSchemas,
  compartmentInternalNodeRegistrationPathname,
  type FastifyResponseSchemas,
  nodeRegistrationRequestSchema,
  nodeRegistrationResponseSchema,
  type NodeRegistrationRequest,
  type NodeRegistrationResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { parseRequestValue } from '../../http/validation';
import { registerNode } from '../../services/node.service';
import type { NodeRegistrationResult } from '../../services/node.service.types';
import { buildNodeSummary } from '../nodes/node.presenter';

interface NodeRegistrationRouteOptions {
  schema: {
    response: FastifyResponseSchemas;
  };
}

export function registerPostNodeRegisterRoute(app: ApiApp, expectedNodeSocketPath: string): void {
  app.post(
    compartmentInternalNodeRegistrationPathname,
    nodeRegistrationRouteOptions,
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await handlePostNodeRegister(request, reply, expectedNodeSocketPath),
  );
}

const nodeRegistrationRouteOptions: NodeRegistrationRouteOptions = {
  schema: {
    response: buildFastifyResponseSchemas({
      200: nodeRegistrationResponseSchema,
    }),
  },
};

async function handlePostNodeRegister(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedNodeSocketPath: string,
): Promise<FastifyReply> {
  const requestBody: NodeRegistrationRequest = parseRequestValue(
    nodeRegistrationRequestSchema,
    request.body,
    'invalid_node_registration_request',
  );
  assertExpectedNodeSocketPath(requestBody.nodeSocketPath, expectedNodeSocketPath);
  const result: NodeRegistrationResult = await registerNode({
    nodeName: requestBody.nodeName,
    nodeSocketPath: requestBody.nodeSocketPath,
    nodeVersion: requestBody.nodeVersion,
  });
  const response: NodeRegistrationResponse = nodeRegistrationResponseSchema.parse({
    node: buildNodeSummary(result.node),
    registeredAt: result.registeredAt.toISOString(),
  });

  return await reply.send(response);
}

function assertExpectedNodeSocketPath(nodeSocketPath: string, expectedNodeSocketPath: string): void {
  if (nodeSocketPath === expectedNodeSocketPath) {
    return;
  }

  throw new ApiBoundaryError(
    400,
    'invalid_node_registration_request',
    'Node registration socket path must match the configured node agent socket path.',
  );
}
