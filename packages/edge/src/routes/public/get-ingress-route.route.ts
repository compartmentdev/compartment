import {
  compartmentIngressRoutePathname,
  compartmentIngressRouteResolvedHeaderName,
  compartmentProxyPathHeaderName,
  compartmentUpstreamHostHeaderName,
  compartmentUpstreamPortHeaderName,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EdgeApp } from '../../app.types';
import type { EdgeConfig } from '../../config';
import type { EdgeAppAccessStateStore } from '../../services/app-access-state-store.service.types';
import { refreshEdgeAccessStateAfterRouteMiss } from '../../services/edge-bootstrap.service';
import type {
  EdgeRouteUpstream,
  LocalEdgeRouteInput,
  LocalEdgeRouteResolution,
} from '../../services/edge-route-resolution.service.types';
import { resolveLocalEdgeRoute } from '../../services/edge-route-resolution.service';
import { readLocalEdgeRouteInputOrReply } from './public-ingress-route-input.service';

export function registerGetIngressRoute(app: EdgeApp, config: EdgeConfig, store: EdgeAppAccessStateStore): void {
  app.get(
    compartmentIngressRoutePathname,
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return await handleIngressRouteRequest(app, request, reply, config, store);
    },
  );
}

async function handleIngressRouteRequest(
  app: EdgeApp,
  request: FastifyRequest,
  reply: FastifyReply,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
): Promise<FastifyReply> {
  const input: LocalEdgeRouteInput | null = await readLocalEdgeRouteInputOrReply(request, reply, config);
  if (input === null) {
    return await reply;
  }
  let resolution: LocalEdgeRouteResolution = resolveLocalEdgeRoute(store, input);
  if (resolution.kind === 'route_not_found') {
    await refreshEdgeAccessStateAfterRouteMiss(config, store, app.edgeSnapshotMetrics, app.log);
    resolution = resolveLocalEdgeRoute(store, input);
  }

  return await replyForIngressRouteResolution(reply, resolution);
}

async function replyForIngressRouteResolution(
  reply: FastifyReply,
  resolution: LocalEdgeRouteResolution,
): Promise<FastifyReply> {
  reply.header(compartmentIngressRouteResolvedHeaderName, '1');
  if (resolution.kind === 'resolved' && resolution.upstream !== null) {
    setResolvedRouteHeaders(reply, resolution.upstream);
  }
  return await reply.code(200).send();
}

function setResolvedRouteHeaders(reply: FastifyReply, upstream: EdgeRouteUpstream): void {
  reply.header(compartmentUpstreamHostHeaderName, upstream.upstreamHost);
  reply.header(compartmentUpstreamPortHeaderName, upstream.upstreamPort.toString());
  if (upstream.proxyPath !== null) {
    reply.header(compartmentProxyPathHeaderName, upstream.proxyPath);
  }
}
