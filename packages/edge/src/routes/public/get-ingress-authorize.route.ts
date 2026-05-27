import {
  compartmentAccessModeHeaderName,
  compartmentIngressAuthorizePathname,
  compartmentIngressAuthorizeResponseHeaderNames,
  compartmentOrganizationIdHeaderName,
  compartmentOrganizationSlugHeaderName,
  compartmentPrincipalEmailHeaderName,
  compartmentPrincipalIdHeaderName,
  compartmentPrincipalTypeHeaderName,
  compartmentProxyPathHeaderName,
  compartmentUpstreamHostHeaderName,
  compartmentUpstreamPortHeaderName,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EdgeApp } from '../../app.types';
import type { EdgeConfig } from '../../config';
import type { EdgeAppAccessStateStore } from '../../services/app-access-state-store.service.types';
import { buildAppFlowStateCookie } from '../../services/edge-app-flow-cookie.service';
import type {
  DeniedEdgeAccessDecision,
  EdgeAccessDecision,
  EdgeAccessDecisionHeaders,
  LocalEdgeAccessInput,
} from '../../services/edge-access-decision.service.types';
import type { ParsedForwardedRequestPath } from '../../services/edge-forwarded-request-path.service';
import { decideLocalEdgeAccess } from '../../services/edge-access-decision.service';
import { buildClearedAppSessionCookie, readAppSessionToken } from '../../services/edge-gateway.service';
import { readAppHostOrReply } from './public-route-host.service';
import {
  readForwardedRequestMethod,
  readForwardedRequestPath,
  replyRouteNotFound,
  setReplyCookies,
} from './public-route.utils';

export function registerGetIngressAuthorizeRoute(
  app: EdgeApp,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
): void {
  app.get(
    compartmentIngressAuthorizePathname,
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return await handleIngressAuthorizeRequest(request, reply, config, store);
    },
  );
}

async function handleIngressAuthorizeRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
): Promise<FastifyReply> {
  const host: string | null = await readAppHostOrReply(request, reply, config);
  if (host === null) {
    return await reply;
  }
  const forwardedRequestPath: ParsedForwardedRequestPath | null = readForwardedRequestPath(request);
  if (forwardedRequestPath === null) {
    return await replyRouteNotFound(reply);
  }
  const forwardedRequestMethod: string | null = readForwardedRequestMethod(request);
  if (forwardedRequestMethod === null) {
    return await replyRouteNotFound(reply);
  }

  return await replyForIngressAuthorizeDecision(reply, config, store, {
    appSessionToken: readAppSessionToken(request.headers.cookie),
    host,
    method: forwardedRequestMethod,
    path: forwardedRequestPath,
  });
}

async function replyForIngressAuthorizeDecision(
  reply: FastifyReply,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  input: LocalEdgeAccessInput,
): Promise<FastifyReply> {
  const decision: EdgeAccessDecision = decideLocalEdgeAccess(store, input);
  if (decision.kind !== 'allowed') {
    return await replyForDeniedIngressAccess(reply, decision);
  }

  setAllowedIngressHeaders(reply, decision.headers, decision.upstreamHost, decision.upstreamPort, decision.proxyPath);

  return await reply.code(200).send();
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
