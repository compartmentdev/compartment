import type { AppAccessRouteState } from '@compartment/contracts';
import type { ParsedForwardedRequestPath } from './edge-forwarded-request-path.service';
import type { MatchedProxyRoute } from './edge-proxy-route.service';

export interface LocalEdgeRouteInput {
  host: string;
  method: string;
  path: ParsedForwardedRequestPath;
}

export interface EdgeRouteUpstream {
  proxyPath: string | null;
  upstreamHost: string;
  upstreamPort: number;
}

export interface ResolvedLocalEdgeRoute {
  kind: 'resolved';
  matchedProxyRoute: MatchedProxyRoute | null;
  route: AppAccessRouteState;
  upstream: EdgeRouteUpstream | null;
}

export interface LocalEdgeRouteNotFound {
  kind: 'route_not_found';
}

export type LocalEdgeRouteResolution = LocalEdgeRouteNotFound | ResolvedLocalEdgeRoute;
