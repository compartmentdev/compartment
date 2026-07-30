import { type AppAccessRouteAuthorizationState, type AppAccessRouteState } from '@compartment/contracts';
import type { EdgeAppAccessSessionEntry, EdgeAppAccessStateStore } from './app-access-state-store.service.types';
import { authorizeRouteAccess, type EdgeAccessAuthorizationResult } from './edge-access-authorization.service';
import type {
  AllowedEdgeAccessDecision,
  EdgeAccessDecision,
  EdgeAccessDecisionHeaders,
  LocalEdgeAccessInput,
} from './edge-access-decision.service.types';
import type { EdgeRouteUpstream, LocalEdgeRouteResolution } from './edge-route-resolution.service.types';
import { resolveLocalEdgeRoute } from './edge-route-resolution.service';

export function decideLocalEdgeAccess(store: EdgeAppAccessStateStore, input: LocalEdgeAccessInput): EdgeAccessDecision {
  const resolution: LocalEdgeRouteResolution = resolveLocalEdgeRoute(store, input);
  if (resolution.kind === 'route_not_found') {
    return buildRouteNotFoundDecision();
  }

  const authorizationResult: EdgeAccessAuthorizationResult | EdgeAccessDecision = authorizeRouteAccess(
    store,
    resolution.route,
    resolution.matchedProxyRoute?.target ?? null,
    input,
  );
  if ('kind' in authorizationResult) {
    return authorizationResult;
  }

  if (resolution.upstream === null) {
    return buildUnavailableProxyDecision(resolution.route);
  }

  return buildAllowedAccessDecision(
    resolution.route,
    buildAccessHeaders(authorizationResult.headerAuthorizationState, resolution.route, authorizationResult.session),
    resolution.upstream,
  );
}

function buildAllowedAccessDecision(
  route: AppAccessRouteState,
  headers: EdgeAccessDecisionHeaders,
  upstream: EdgeRouteUpstream,
): AllowedEdgeAccessDecision {
  return {
    kind: 'allowed',
    headers,
    proxyPath: upstream.proxyPath,
    routeHost: route.host,
    routeScopeId: route.routeScopeId,
    routeScopeType: route.routeScopeType,
    upstreamHost: upstream.upstreamHost,
    upstreamPort: upstream.upstreamPort,
  };
}

function buildAccessHeaders(
  authorizationState: AppAccessRouteAuthorizationState,
  route: AppAccessRouteState,
  session: EdgeAppAccessSessionEntry | null,
): EdgeAccessDecisionHeaders {
  if (authorizationState.accessMode === 'public') {
    return {
      accessMode: authorizationState.accessMode,
      organizationId: route.organizationId,
      organizationSlug: route.organizationSlug,
    };
  }
  if (session === null) {
    throw new Error('Expected app session for authenticated app access headers.');
  }

  return {
    accessMode: authorizationState.accessMode,
    organizationId: route.organizationId,
    organizationSlug: route.organizationSlug,
    principalEmail: session.principalEmail,
    principalId: session.principalId,
    principalType: session.principalType,
  };
}

function buildUnavailableProxyDecision(route: AppAccessRouteState): EdgeAccessDecision {
  return {
    kind: 'unavailable',
    routeHost: route.host,
    routeScopeId: route.routeScopeId,
    routeScopeType: route.routeScopeType,
  };
}

function buildRouteNotFoundDecision(): EdgeAccessDecision {
  return {
    kind: 'route_not_found',
  };
}
