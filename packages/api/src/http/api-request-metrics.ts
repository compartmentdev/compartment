import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import type { ApiApp } from '../app.types';
import { observeApiHttpRequest } from '../services/platform-metrics.service';

const unmatchedRouteLabel: string = 'unmatched';

export function registerApiRequestMetrics(app: ApiApp): void {
  app.addHook('onResponse', recordApiRequestMetrics);
}

function recordApiRequestMetrics(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void {
  observeApiHttpRequest(
    request.method,
    request.routeOptions.url ?? unmatchedRouteLabel,
    reply.statusCode,
    reply.elapsedTime,
  );
  done();
}
