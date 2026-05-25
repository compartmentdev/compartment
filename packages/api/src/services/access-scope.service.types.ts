import type {
  AppAccessGrantState,
  AppAccessScopeReference,
  AppAccessScopeType,
  PermissionKey,
} from '@compartment/contracts';

export type AccessScopeReference = AppAccessScopeReference;
export type PrincipalPermissionGrant = AppAccessGrantState;
export type AccessScopeTypeValue = AppAccessScopeType;

export interface EffectiveAccess {
  grantedScopeId: string;
  grantedScopeType: AccessScopeTypeValue;
  permissions: PermissionKey[];
}

export interface RouteScopeResolution {
  organizationId: string | null;
  scopeChain: AccessScopeReference[];
}

export interface PrincipalAccessEvaluationInput {
  organizationId: string;
  principalId: string;
  routeScope: AccessScopeReference;
}
