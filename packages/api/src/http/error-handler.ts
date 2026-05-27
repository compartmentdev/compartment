import {
  createErrorResponse,
  nodeRuntimeResourceReadinessFailedErrorCode,
  type ErrorDetails,
} from '@compartment/contracts';
import { readNodeRequestRuntimeError } from '@compartment/sdk';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../app.types';
import { isApiBoundaryError } from '../errors/api-boundary-error';
import { isApiBusinessError, mapApiBusinessError } from '../errors/api-business-error';
import type { ApiErrorResponsePayload } from './error-handler.types';
import type { ApiStatusCodeCarrier } from './http.types';

interface NodeRuntimeRequestStatusCarrier extends Error {
  status: number;
}

export function registerApiErrorHandler(app: ApiApp): void {
  app.setErrorHandler(async (error: Error, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const mappedError: ApiErrorResponsePayload = mapApiError(error);

    if (mappedError.statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled API error.');
    }

    if (mappedError.headers !== undefined) {
      for (const [headerName, headerValue] of Object.entries(mappedError.headers)) {
        reply.header(headerName, headerValue);
      }
    }

    return await reply.code(mappedError.statusCode).send(createErrorResponse(mappedError.code, mappedError.message));
  });
}

function mapApiError(error: Error): ApiErrorResponsePayload {
  return (
    mapBoundaryError(error) ??
    mapBusinessError(error) ??
    mapNodeRuntimeRequestError(error) ??
    mapKnownRequestError(error) ??
    createInternalError()
  );
}

function mapBoundaryError(error: Error): ApiErrorResponsePayload | null {
  if (!isApiBoundaryError(error)) {
    return null;
  }

  return {
    code: error.code,
    headers: error.headers,
    message: error.message,
    statusCode: error.statusCode,
  };
}

function mapBusinessError(error: Error): ApiErrorResponsePayload | null {
  if (!isApiBusinessError(error)) {
    return null;
  }

  return mapApiBusinessError(error);
}

function mapKnownRequestError(error: Error): ApiErrorResponsePayload | null {
  if (!hasStatusCode(error) || error.statusCode < 400 || error.statusCode >= 500) {
    return null;
  }

  return {
    code: 'request_error',
    message: error.message,
    statusCode: error.statusCode,
  };
}

function mapNodeRuntimeRequestError(error: Error): ApiErrorResponsePayload | null {
  const runtimeError: ErrorDetails | null = readNodeRequestRuntimeError(error);
  if (
    runtimeError === null ||
    !hasNodeRuntimeRequestStatus(error) ||
    error.status < 500 ||
    !isSurfacedNodeRuntimeErrorCode(runtimeError.code)
  ) {
    return null;
  }

  return {
    code: runtimeError.code,
    message: runtimeError.message,
    statusCode: error.status,
  };
}

function isSurfacedNodeRuntimeErrorCode(code: string): boolean {
  return code === nodeRuntimeResourceReadinessFailedErrorCode;
}

function hasStatusCode(value: Error): value is ApiStatusCodeCarrier {
  return value instanceof Error && 'statusCode' in value && typeof value.statusCode === 'number';
}

function hasNodeRuntimeRequestStatus(value: Error): value is NodeRuntimeRequestStatusCarrier {
  return value instanceof Error && 'status' in value && typeof value.status === 'number';
}

function createInternalError(): ApiErrorResponsePayload {
  return {
    code: 'internal_error',
    message: 'An unexpected error occurred.',
    statusCode: 500,
  };
}
