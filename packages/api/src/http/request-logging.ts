import { compartmentInternalAppAccessStatePathname, workerClaimNextDeploymentPathname } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import type { ApiApp } from '../app.types';

const internalPollingRoutes: readonly InternalPollingRoute[] = [
  { method: 'GET', path: compartmentInternalAppAccessStatePathname },
  { method: 'POST', path: workerClaimNextDeploymentPathname },
];

interface InternalPollingRoute {
  method: 'GET' | 'POST';
  path: string;
}

interface RequestStartLogPayload {
  method: string;
  path: string;
}

interface RequestCompletionLogPayload extends RequestStartLogPayload {
  responseTime: number;
  statusCode: number;
}

export function registerApiRequestLogging(app: ApiApp): void {
  app.addHook('onRequest', logApiRequestStart);
  app.addHook('onResponse', logApiRequestCompletion);
}

function logApiRequestStart(request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction): void {
  const requestPath: string = readRequestPath(request);
  if (!isInternalPollingRequest(request.method, requestPath)) {
    request.log.info(buildRequestLogPayload(request, requestPath), 'incoming request');
  }

  done();
}

function logApiRequestCompletion(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void {
  const requestPath: string = readRequestPath(request);
  if (isInternalPollingRequest(request.method, requestPath)) {
    logPollingRequestCompletionIfNeeded(request, reply, requestPath);
    done();
    return;
  }

  request.log.info(buildResponseLogPayload(request, reply, requestPath), 'request completed');
  done();
}

function logPollingRequestCompletionIfNeeded(request: FastifyRequest, reply: FastifyReply, requestPath: string): void {
  if (reply.statusCode < 400) {
    return;
  }

  request.log.warn(buildResponseLogPayload(request, reply, requestPath), 'request completed');
}

function buildRequestLogPayload(request: FastifyRequest, requestPath: string): RequestStartLogPayload {
  return {
    method: request.method,
    path: requestPath,
  };
}

function buildResponseLogPayload(
  request: FastifyRequest,
  reply: FastifyReply,
  requestPath: string,
): RequestCompletionLogPayload {
  return {
    method: request.method,
    path: requestPath,
    responseTime: reply.elapsedTime,
    statusCode: reply.statusCode,
  };
}

function isInternalPollingRequest(method: string, path: string): boolean {
  return internalPollingRoutes.some(
    (route: InternalPollingRoute): boolean => route.method === method && route.path === path,
  );
}

function readRequestPath(request: FastifyRequest): string {
  return new URL(request.raw.url ?? request.url, 'https://compartment.internal').pathname;
}
