import {
  compartmentAppCallbackPathname,
  compartmentAppLogoutPathname,
  type AppAccessProxyRouteAvailableTargetState,
  type AppAccessProxyRouteTargetState,
  type AppAccessRouteState,
} from '@compartment/contracts';
import type { EdgeAppAccessStateStore } from './app-access-state-store.service.types';
import { matchProxyRoute, type MatchedProxyRoute } from './edge-proxy-route.service';
import type {
  EdgeRouteUpstream,
  LocalEdgeRouteInput,
  LocalEdgeRouteResolution,
} from './edge-route-resolution.service.types';

export function resolveLocalEdgeRoute(
  store: EdgeAppAccessStateStore,
  input: LocalEdgeRouteInput,
): LocalEdgeRouteResolution {
  const route: AppAccessRouteState | null = store.getRoute(input.host);
  if (route === null) {
    return { kind: 'route_not_found' };
  }
  const matchedProxyRoute: MatchedProxyRoute | null = isEdgeOwnedAppFlowPath(input.path.pathname)
    ? null
    : matchProxyRoute(route.proxyRoutes, input.method, input.path);

  return {
    kind: 'resolved',
    matchedProxyRoute,
    route,
    upstream: resolveEdgeRouteUpstream(route, matchedProxyRoute),
  };
}

function isEdgeOwnedAppFlowPath(pathname: string): boolean {
  return pathname === compartmentAppCallbackPathname || pathname === compartmentAppLogoutPathname;
}

function resolveEdgeRouteUpstream(
  route: AppAccessRouteState,
  matchedProxyRoute: MatchedProxyRoute | null,
): EdgeRouteUpstream | null {
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
