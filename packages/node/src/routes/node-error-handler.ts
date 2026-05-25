import { createErrorResponse } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { NodeApp } from '../app.types';
import { isNodeBoundaryError } from '../errors/node-boundary-error';
import { invalidNodeInternalRequestMessage } from './internal/node-internal-validation';

interface NodeErrorResponsePayload {
  code: string;
  message: string;
  statusCode: number;
}

interface NodeStatusCodeCarrier extends Error {
  statusCode: number;
}

export function registerNodeErrorHandler(app: NodeApp): void {
  app.setErrorHandler(async (error: Error, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const mappedError: NodeErrorResponsePayload = mapNodeError(error);

    if (mappedError.statusCode >= 500) {
      request.log.error({ error }, 'Unhandled node runtime error.');
    }

    return await reply.code(mappedError.statusCode).send(createErrorResponse(mappedError.code, mappedError.message));
  });
}

function mapNodeError(error: Error): NodeErrorResponsePayload {
  if (isNodeBoundaryError(error)) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  if (error instanceof ZodError) {
    return createInvalidNodeInternalRequestError();
  }

  if (hasRequestStatusCode(error)) {
    return createInvalidNodeInternalRequestError(error.statusCode);
  }

  return {
    code: 'internal_error',
    message: 'An unexpected error occurred.',
    statusCode: 500,
  };
}

function createInvalidNodeInternalRequestError(statusCode: number = 400): NodeErrorResponsePayload {
  return {
    code: 'invalid_node_internal_request',
    message: invalidNodeInternalRequestMessage,
    statusCode,
  };
}

function hasRequestStatusCode(value: Error): value is NodeStatusCodeCarrier {
  return (
    'statusCode' in value && typeof value.statusCode === 'number' && value.statusCode >= 400 && value.statusCode < 500
  );
}
