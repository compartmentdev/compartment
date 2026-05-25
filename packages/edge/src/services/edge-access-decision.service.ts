import {
  type AppAccessProxyRouteAvailableTargetState,
  type AppAccessProxyRouteTargetState,
  type AppAccessRouteAuthorizationState,
  type AppAccessRouteState,
} from '@compartment/contracts';
import type { EdgeAppAccessSessionEntry, EdgeAppAccessStateStore } from './app-access-state-store.service.types';
import { authorizeRouteAccess, type EdgeAccessAuthorizationResult } from './edge-access-authorization.service';
import type {
  AllowedEdgeAccessDecision,
  EdgeAccessDecision,
  EdgeAccessDecisionHeaders,
  LocalEdgeAccessInput,
} from './edge-access-decision.service.types';
import { matchProxyRoute, type MatchedProxyRoute } from './edge-proxy-route.service';

interface AllowedEdgeAccessUpstream {
  proxyPath: string | null;
  upstreamHost: string;
  upstreamPort: number;
}

export function decideLocalEdgeAccess(store: EdgeAppAccessStateStore, input: LocalEdgeAccessInput): EdgeAccessDecision {
  const route: AppAccessRouteState | null = store.getRoute(input.host);
  if (route === null) {
    return buildRouteNotFoundDecision();
  }

  const matchedProxyRoute: MatchedProxyRoute | null = matchProxyRoute(route.proxyRoutes, input.method, input.path);
  const authorizationResult: EdgeAccessAuthorizationResult | EdgeAccessDecision = authorizeRouteAccess(
    store,
    route,
    matchedProxyRoute?.target ?? null,
    input,
  );
  if ('kind' in authorizationResult) {
    return authorizationResult;
  }

  const upstream: AllowedEdgeAccessUpstream | null = resolveAllowedAccessUpstream(route, matchedProxyRoute);
  if (upstream === null) {
    return buildUnavailableProxyDecision(route);
  }

  return buildAllowedAccessDecision(
    route,
    buildAccessHeaders(authorizationResult.headerAuthorizationState, route, authorizationResult.session),
    upstream,
  );
}

function buildAllowedAccessDecision(
  route: AppAccessRouteState,
  headers: EdgeAccessDecisionHeaders,
  upstream: AllowedEdgeAccessUpstream,
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

function resolveAllowedAccessUpstream(
  route: AppAccessRouteState,
  matchedProxyRoute: MatchedProxyRoute | null,
): AllowedEdgeAccessUpstream | null {
  if (matchedProxyRoute === null) {
    return {
      proxyPath: null,
      upstreamHost: route.upstreamHost,
      upstreamPort: route.upstreamPort,
    };
  }
  const target: AppAccessProxyRouteTargetState | null = matchedProxyRoute.target;
  if (!isAvailableProxyRouteTarget(target)) {
    return null;
  }

  return {
    proxyPath: matchedProxyRoute.proxyPath,
    upstreamHost: target.upstreamHost,
    upstreamPort: target.upstreamPort,
  };
}

function isAvailableProxyRouteTarget(
  target: AppAccessProxyRouteTargetState | null,
): target is AppAccessProxyRouteAvailableTargetState {
  return target?.upstreamHost !== undefined && target.upstreamHost !== null;
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
