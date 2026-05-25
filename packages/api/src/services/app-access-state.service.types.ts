import type { AppAccessProxyRouteState, AppAccessRouteState, AppAccessScopeReference } from '@compartment/contracts';
import type { DeploymentRouteLookupRow } from '../queries/deployment-routes.query.types';

export type RouteScopeChainInput = Pick<
  DeploymentRouteLookupRow,
  'accessScopeId' | 'accessScopeType' | 'environmentId' | 'organizationId' | 'projectId'
>;

export interface DeploymentRouteStateInput extends DeploymentRouteLookupRow {
  proxyRoutes: AppAccessProxyRouteState[];
  scopeChain: AppAccessScopeReference[];
}

export interface AppAccessRouteStateTargetRoutesInput {
  route: DeploymentRouteLookupRow;
  targetRoutes: DeploymentRouteLookupRow[];
}

export interface AppAccessRouteStateContext {
  customRoutes: DeploymentRouteLookupRow[];
  routes: AppAccessRouteState[];
}
