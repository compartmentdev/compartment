import {
  compartmentAccessModeHeaderName,
  compartmentIngressAuthorizePathname,
  compartmentIngressAuthorizeResponseHeaderNames,
  compartmentIngressRouteResolvedHeaderName,
  compartmentOrganizationIdHeaderName,
  compartmentOrganizationSlugHeaderName,
  compartmentPrincipalEmailHeaderName,
  compartmentPrincipalIdHeaderName,
  compartmentPrincipalTypeHeaderName,
  compartmentProxyPathHeaderName,
  compartmentUpstreamHostHeaderName,
  compartmentUpstreamPortHeaderName,
  type AppAccessSessionState,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EdgeApp } from '../../app.types';
import type { EdgeConfig } from '../../config';
import type { EdgeAppAccessStateStore } from '../../services/app-access-state-store.service.types';
import { buildAppFlowStateCookie } from '../../services/edge-app-flow-cookie.service';
import { refreshEdgeAccessStateAfterRouteMiss } from '../../services/edge-bootstrap.service';
import type {
  DeniedEdgeAccessDecision,
  EdgeAccessDecision,
  EdgeAccessDecisionHeaders,
  LocalEdgeAccessInput,
} from '../../services/edge-access-decision.service.types';
import { decideLocalEdgeAccess } from '../../services/edge-access-decision.service';
import {
  buildClearedAppSessionCookie,
  readAppSessionToken,
  resolveAppAccessSessionWithApi,
} from '../../services/edge-gateway.service';
import { readLocalEdgeRouteInputOrReply } from './public-ingress-route-input.service';
import { replyRouteNotFound, setReplyCookies } from './public-route.utils';
import type { LocalEdgeRouteInput } from '../../services/edge-route-resolution.service.types';

export function registerGetIngressAuthorizeRoute(
  app: EdgeApp,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
): void {
  app.get(
    compartmentIngressAuthorizePathname,
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return await handleIngressAuthorizeRequest(app, request, reply, config, store);
    },
  );
}

async function handleIngressAuthorizeRequest(
  app: EdgeApp,
  request: FastifyRequest,
  reply: FastifyReply,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
): Promise<FastifyReply> {
  const routeInput: LocalEdgeRouteInput | null = await readLocalEdgeRouteInputOrReply(request, reply, config);
  if (routeInput === null) {
    return await reply;
  }
  const input: LocalEdgeAccessInput = {
    ...routeInput,
    appSessionToken: readAppSessionToken(request.headers.cookie),
  };

  return await replyForIngressAuthorizeDecision(app, request, reply, config, store, input);
}

async function replyForIngressAuthorizeDecision(
  app: EdgeApp,
  request: FastifyRequest,
  reply: FastifyReply,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  input: LocalEdgeAccessInput,
): Promise<FastifyReply> {
  await refreshAppAccessSession(config, store, input.appSessionToken);
  let decision: EdgeAccessDecision = decideLocalEdgeAccess(store, input);
  if (decision.kind === 'route_not_found') {
    await refreshEdgeAccessStateAfterRouteMiss(config, store, app.edgeSnapshotMetrics, app.log);
    decision = decideLocalEdgeAccess(store, input);
  }
  if (decision.kind !== 'allowed') {
    return await replyForDeniedIngressAccess(reply, decision);
  }
  if (!acceptsResolvedRouteSelection(request, decision)) {
    return await reply.code(503).send({ error: 'unavailable' });
  }

  setAllowedIngressHeaders(reply, decision.headers, decision.upstreamHost, decision.upstreamPort, decision.proxyPath);

  return await reply.code(200).send();
}

function acceptsResolvedRouteSelection(
  request: FastifyRequest,
  decision: Extract<EdgeAccessDecision, { kind: 'allowed' }>,
): boolean {
  const routeResolved: string | string[] | undefined =
    request.headers[compartmentIngressRouteResolvedHeaderName.toLowerCase()];
  if (routeResolved === undefined) {
    return true;
  }
  if (routeResolved !== '1') {
    return false;
  }
  const upstreamHost: string | string[] | undefined = request.headers[compartmentUpstreamHostHeaderName.toLowerCase()];
  const upstreamPort: string | string[] | undefined = request.headers[compartmentUpstreamPortHeaderName.toLowerCase()];
  const proxyPath: string | string[] | undefined = request.headers[compartmentProxyPathHeaderName.toLowerCase()];

  return (
    upstreamHost === decision.upstreamHost &&
    upstreamPort === decision.upstreamPort.toString() &&
    proxyPath === (decision.proxyPath ?? undefined)
  );
}

async function refreshAppAccessSession(
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  appSessionToken: string | null,
): Promise<void> {
  if (appSessionToken === null) {
    return;
  }
  if (config.replicaCount === 1 && store.getSession(appSessionToken) !== null) {
    return;
  }
  let session: AppAccessSessionState | null;
  try {
    session = await resolveAppAccessSessionWithApi(config, appSessionToken);
  } catch {
    return;
  }
  if (session === null) {
    store.clearSession(appSessionToken);
    return;
  }
  store.setSession(appSessionToken, session);
}

async function replyForDeniedIngressAccess(
  reply: FastifyReply,
  decision: DeniedEdgeAccessDecision,
): Promise<FastifyReply> {
  const setCookies: string[] = buildDeniedResponseCookies(decision);
  setReplyCookies(reply, setCookies);

  switch (decision.kind) {
    case 'login_required':
      return await reply.redirect(decision.loginUrl);
    case 'unavailable':
      return await reply.code(503).send({ error: 'unavailable' });
    case 'route_not_found':
      return await replyRouteNotFound(reply);
    case 'forbidden':
      return await reply.code(403).send({ error: 'forbidden' });
  }
}

function buildDeniedResponseCookies(decision: DeniedEdgeAccessDecision): string[] {
  const cookies: string[] = [];
  if (decision.kind === 'login_required' && decision.clearAppSession) {
    cookies.push(buildClearedAppSessionCookie());
  }
  if (decision.kind === 'login_required') {
    cookies.push(buildAppFlowStateCookie(decision.loginFlowState));
  }

  return cookies;
}

function setAllowedIngressHeaders(
  reply: FastifyReply,
  headers: EdgeAccessDecisionHeaders,
  upstreamHost: string,
  upstreamPort: number,
  proxyPath: string | null,
): void {
  const headerValues: Record<string, string | undefined> = buildAllowedIngressHeaderValues(
    headers,
    upstreamHost,
    upstreamPort,
    proxyPath,
  );

  for (const headerName of compartmentIngressAuthorizeResponseHeaderNames) {
    const value: string | undefined = headerValues[headerName];
    if (value !== undefined) {
      reply.header(headerName, value);
    }
  }
}

function buildAllowedIngressHeaderValues(
  headers: EdgeAccessDecisionHeaders,
  upstreamHost: string,
  upstreamPort: number,
  proxyPath: string | null,
): Record<string, string | undefined> {
  return {
    [compartmentAccessModeHeaderName]: headers.accessMode,
    [compartmentOrganizationIdHeaderName]: headers.organizationId,
    [compartmentOrganizationSlugHeaderName]: headers.organizationSlug,
    [compartmentPrincipalEmailHeaderName]: headers.principalEmail,
    [compartmentPrincipalIdHeaderName]: headers.principalId,
    [compartmentPrincipalTypeHeaderName]: headers.principalType,
    [compartmentUpstreamHostHeaderName]: upstreamHost,
    [compartmentUpstreamPortHeaderName]: upstreamPort.toString(),
    ...(proxyPath === null ? {} : { [compartmentProxyPathHeaderName]: proxyPath }),
  };
}
