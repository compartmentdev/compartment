import {
  matchCompartmentRoute,
  type CompartmentRouteMatch,
  type AppAccessProxyRouteState,
  type AppAccessProxyRouteTargetState,
} from '@compartment/contracts';
import type { ParsedForwardedRequestPath } from './edge-forwarded-request-path.service';

export interface MatchedProxyRoute {
  proxyPath: string;
  target: AppAccessProxyRouteTargetState | null;
}

export function matchProxyRoute(
  proxyRoutes: AppAccessProxyRouteState[],
  method: string,
  requestPath: ParsedForwardedRequestPath,
): MatchedProxyRoute | null {
  const match: CompartmentRouteMatch<AppAccessProxyRouteState> | null = matchCompartmentRoute(
    proxyRoutes,
    method,
    requestPath,
  );
  if (match === null) {
    return null;
  }

  return {
    proxyPath: match.proxyPath,
    target: match.route.target,
  };
}
