import type { CompartmentAccessScopeType, PermissionKey } from './access.contract';
import type {
  AppAccessGrantState,
  AppAccessProxyRouteTargetState,
  AppAccessRouteAuthorizationState,
  AppAccessRouteState,
  AppAccessScopeReference,
} from './app-access-state.contract';

export interface CompartmentEffectiveAccess {
  grantedScopeId: string;
  grantedScopeType: CompartmentAccessScopeType;
  permissions: PermissionKey[];
}

export interface AppAccessRouteAuthorizationContext {
  authorizationStates: AppAccessRouteAuthorizationState[];
  headerAuthorizationState: AppAccessRouteAuthorizationState;
}

export function resolveCompartmentAccess(
  scopeChain: AppAccessScopeReference[],
  grants: AppAccessGrantState[],
  requiredPermission?: PermissionKey,
): CompartmentEffectiveAccess | null {
  for (const scope of scopeChain) {
    const scopedPermissions: PermissionKey[] = readScopedPermissions(scope, grants);
    if (scopedPermissions.length === 0) {
      continue;
    }
    if (requiredPermission !== undefined && !scopedPermissions.includes(requiredPermission)) {
      return null;
    }

    return {
      grantedScopeId: scope.scopeId,
      grantedScopeType: scope.scopeType,
      permissions: scopedPermissions,
    };
  }

  return null;
}

export function readAppAccessRouteAuthorizationContext(
  route: AppAccessRouteState,
  target: AppAccessProxyRouteTargetState | null,
): AppAccessRouteAuthorizationContext {
  const authorizationStates: AppAccessRouteAuthorizationState[] = readAuthenticatedAppAccessAuthorizationStates(
    route,
    target,
  );

  return {
    authorizationStates,
    headerAuthorizationState: readAppAccessHeaderAuthorizationState(route, target, authorizationStates),
  };
}

function readScopedPermissions(scope: AppAccessScopeReference, grants: AppAccessGrantState[]): PermissionKey[] {
  return [
    ...new Set(
      grants
        .filter((entry: AppAccessGrantState): boolean => matchesScope(entry, scope))
        .flatMap((entry: AppAccessGrantState): PermissionKey[] => entry.permissions),
    ),
  ];
}

function matchesScope(grant: AppAccessGrantState, scope: AppAccessScopeReference): boolean {
  return grant.scopeType === scope.scopeType && grant.scopeId === scope.scopeId;
}

function readAppAccessHeaderAuthorizationState(
  route: AppAccessRouteState,
  target: AppAccessProxyRouteTargetState | null,
  authorizationStates: AppAccessRouteAuthorizationState[],
): AppAccessRouteAuthorizationState {
  const authenticatedAuthorizationState: AppAccessRouteAuthorizationState | undefined =
    authorizationStates[authorizationStates.length - 1];
  if (authenticatedAuthorizationState !== undefined) {
    return authenticatedAuthorizationState;
  }

  return target ?? route;
}

function readAuthenticatedAppAccessAuthorizationStates(
  route: AppAccessRouteState,
  target: AppAccessProxyRouteTargetState | null,
): AppAccessRouteAuthorizationState[] {
  const authorizationStates: AppAccessRouteAuthorizationState[] = [];
  if (route.accessMode === 'authenticated') {
    authorizationStates.push(route);
  }
  if (
    target?.accessMode === 'authenticated' &&
    (route.accessMode !== 'authenticated' || !hasSameAppAccessRouteAuthorizationState(route, target))
  ) {
    authorizationStates.push(target);
  }

  return authorizationStates;
}

function hasSameAppAccessRouteAuthorizationState(
  left: AppAccessRouteAuthorizationState,
  right: AppAccessRouteAuthorizationState,
): boolean {
  return left.routeScopeId === right.routeScopeId && left.routeScopeType === right.routeScopeType;
}
