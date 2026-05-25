import type { AppRouteAccessMode, CompartmentAccessScopeType } from '@compartment/contracts';
import type { ParsedForwardedRequestPath } from './edge-forwarded-request-path.service';

export interface LocalEdgeAccessInput {
  appSessionToken: string | null;
  host: string;
  method: string;
  path: ParsedForwardedRequestPath;
}

export interface EdgeAccessDecisionHeaders {
  accessMode: AppRouteAccessMode;
  organizationId: string;
  organizationSlug: string;
  principalEmail?: string | undefined;
  principalId?: string | undefined;
  principalType?: 'user' | undefined;
}

interface EdgeRouteDecisionScope {
  routeHost: string;
  routeScopeId: string;
  routeScopeType: CompartmentAccessScopeType;
}

export interface AllowedEdgeAccessDecision extends EdgeRouteDecisionScope {
  headers: EdgeAccessDecisionHeaders;
  kind: 'allowed';
  proxyPath: string | null;
  upstreamHost: string;
  upstreamPort: number;
}

export interface LoginRequiredEdgeAccessDecision {
  clearAppSession: boolean;
  kind: 'login_required';
  loginFlowState: string;
  loginUrl: string;
  routeHost: string;
}

export interface ForbiddenEdgeAccessDecision extends EdgeRouteDecisionScope {
  kind: 'forbidden';
}

export interface RouteNotFoundEdgeAccessDecision {
  kind: 'route_not_found';
}

export interface UnavailableEdgeAccessDecision extends EdgeRouteDecisionScope {
  kind: 'unavailable';
}

export type DeniedEdgeAccessDecision =
  | ForbiddenEdgeAccessDecision
  | LoginRequiredEdgeAccessDecision
  | RouteNotFoundEdgeAccessDecision
  | UnavailableEdgeAccessDecision;

export type EdgeAccessDecision = AllowedEdgeAccessDecision | DeniedEdgeAccessDecision;
