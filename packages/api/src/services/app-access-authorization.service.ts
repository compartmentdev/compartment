import {
  matchCompartmentRoute,
  readAppAccessRouteAuthorizationContext,
  resolveCompartmentAccess,
  type AppAccessGrantState,
  type AppAccessProxyRouteState,
  type AppAccessProxyRouteTargetState,
  type AppAccessRouteAuthorizationContext,
  type AppAccessRouteAuthorizationState,
  type AppAccessRouteState,
  type CompartmentEffectiveAccess,
  type CompartmentRouteMatch,
} from '@compartment/contracts';
import { getApiConfig } from '../runtime/runtime-access';
import { readAppAccessRouteStateByHost } from './app-access-state.service';
import { listPrincipalPermissionGrants } from './access-scope.service';
import { isAuthSessionAllowedForOrganization } from './organization-auth-settings.service';
import type {
  AppRouteAccessCheckInput,
  AppRouteAccessEvaluationInput,
  AppRouteAccessRequestPath,
} from './app-access-authorization.service.types';
import type { PrincipalPermissionGrant } from './access-scope.service.types';

const appAccessRedirectMethod: string = 'GET';
const routeRequestPathBaseUrl: string = 'https://compartment.local';

export async function canAuthSessionAccessAppRoute(input: AppRouteAccessCheckInput): Promise<boolean> {
  return await evaluateAuthSessionAppRouteAccess({
    host: input.host,
    method: appAccessRedirectMethod,
    path: input.path,
    session: input.session,
  });
}

async function evaluateAuthSessionAppRouteAccess(input: AppRouteAccessEvaluationInput): Promise<boolean> {
  const route: AppAccessRouteState | null = await readSessionAppAccessRoute(input);
  if (route === null) {
    return false;
  }

  return await hasSessionAppRouteAuthorization(input, route);
}

async function readSessionAppAccessRoute(input: AppRouteAccessEvaluationInput): Promise<AppAccessRouteState | null> {
  if (input.session.principalType !== 'user') {
    return null;
  }

  const route: AppAccessRouteState | null = await readAppAccessRoute(input.host);
  if (route === null) {
    return null;
  }
  if (input.session.organizationId !== route.organizationId) {
    return null;
  }
  if (
    !(await isAuthSessionAllowedForOrganization({
      organizationId: route.organizationId,
      session: input.session,
    }))
  ) {
    return null;
  }

  return route;
}

async function hasSessionAppRouteAuthorization(
  input: AppRouteAccessEvaluationInput,
  route: AppAccessRouteState,
): Promise<boolean> {
  const authorizationContext: AppAccessRouteAuthorizationContext = readAppAccessRouteAuthorizationContext(
    route,
    readAppAccessProxyRouteTarget(route, input.method, input.path),
  );
  if (authorizationContext.authorizationStates.length === 0) {
    return true;
  }

  const grants: PrincipalPermissionGrant[] = await listPrincipalPermissionGrants(
    route.organizationId,
    input.session.principalId,
  );

  return authorizationContext.authorizationStates.every(
    (authorizationState: AppAccessRouteAuthorizationState): boolean => hasAppRouteAccess(authorizationState, grants),
  );
}

async function readAppAccessRoute(host: string): Promise<AppAccessRouteState | null> {
  return await readAppAccessRouteStateByHost(host, getApiConfig().baseDomain);
}

function readAppAccessProxyRouteTarget(
  route: AppAccessRouteState,
  method: string | undefined,
  path: string,
): AppAccessProxyRouteTargetState | null {
  const match: CompartmentRouteMatch<AppAccessProxyRouteState> | null = matchCompartmentRoute(
    route.proxyRoutes,
    method ?? appAccessRedirectMethod,
    readAppRouteRequestPath(path),
  );

  return match?.route.target ?? null;
}

function readAppRouteRequestPath(path: string): AppRouteAccessRequestPath {
  const url: URL = new URL(path, routeRequestPathBaseUrl);

  return {
    pathname: url.pathname,
    search: url.search,
  };
}

function hasAppRouteAccess(
  authorizationState: AppAccessRouteAuthorizationState,
  grants: AppAccessGrantState[],
): boolean {
  const effectiveAccess: CompartmentEffectiveAccess | null = resolveCompartmentAccess(
    authorizationState.scopeChain,
    grants,
    'app.route.access',
  );

  return effectiveAccess !== null;
}
