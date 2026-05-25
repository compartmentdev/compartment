import { randomUUID } from 'node:crypto';
import {
  readAppAccessRouteAuthorizationContext,
  resolveCompartmentAccess,
  type AppAccessGrantState,
  type AppAccessProxyRouteTargetState,
  type AppAccessRouteAuthorizationContext,
  type AppAccessRouteAuthorizationState,
  type AppAccessRouteState,
  type CompartmentEffectiveAccess,
} from '@compartment/contracts';
import { sanitizeSafeRelativePath } from '@compartment/utils';
import type { EdgeAppAccessSessionEntry, EdgeAppAccessStateStore } from './app-access-state-store.service.types';
import type { EdgeAccessDecision, LocalEdgeAccessInput } from './edge-access-decision.service.types';
import { formatForwardedRequestPath } from './edge-forwarded-request-path.service';

export interface EdgeAccessAuthorizationResult {
  headerAuthorizationState: AppAccessRouteAuthorizationState;
  session: EdgeAppAccessSessionEntry | null;
}

export function authorizeRouteAccess(
  store: EdgeAppAccessStateStore,
  route: AppAccessRouteState,
  target: AppAccessProxyRouteTargetState | null,
  input: LocalEdgeAccessInput,
): EdgeAccessAuthorizationResult | EdgeAccessDecision {
  const authorizationContext: AppAccessRouteAuthorizationContext = readAppAccessRouteAuthorizationContext(
    route,
    target,
  );
  if (authorizationContext.authorizationStates.length === 0) {
    return { headerAuthorizationState: authorizationContext.headerAuthorizationState, session: null };
  }

  const session: EdgeAppAccessSessionEntry | null = readActiveSession(store, input.appSessionToken, input.host);
  if (session === null) {
    return buildLoginRequiredDecisionForInput(store, route, input);
  }

  const grants: AppAccessGrantState[] = store.getGrants(session.principalId);
  for (const authorizationState of authorizationContext.authorizationStates) {
    if (!hasAppRouteAccess(authorizationState, grants)) {
      return buildForbiddenAccessDecision(authorizationState, route.host);
    }
  }

  return { headerAuthorizationState: authorizationContext.headerAuthorizationState, session };
}

function buildLoginRequiredDecisionForInput(
  store: EdgeAppAccessStateStore,
  route: AppAccessRouteState,
  input: LocalEdgeAccessInput,
): EdgeAccessDecision {
  return buildLoginRequiredDecision(
    store,
    route.host,
    formatForwardedRequestPath(input.path),
    input.appSessionToken !== null,
  );
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

function buildForbiddenAccessDecision(
  authorizationState: AppAccessRouteAuthorizationState,
  host: string,
): EdgeAccessDecision {
  return {
    kind: 'forbidden',
    routeHost: host,
    routeScopeId: authorizationState.routeScopeId,
    routeScopeType: authorizationState.routeScopeType,
  };
}

function readActiveSession(
  store: EdgeAppAccessStateStore,
  appSessionToken: string | null,
  host: string,
): EdgeAppAccessSessionEntry | null {
  if (appSessionToken === null) {
    return null;
  }

  const session: EdgeAppAccessSessionEntry | null = store.getSession(appSessionToken);
  if (session === null) {
    return null;
  }
  if (session.host !== host) {
    return null;
  }
  if (new Date(session.expiresAt) <= new Date()) {
    store.clearSession(appSessionToken);
    return null;
  }

  return session;
}

function buildLoginRequiredDecision(
  store: EdgeAppAccessStateStore,
  host: string,
  path: string,
  clearAppSession: boolean,
): EdgeAccessDecision {
  const compartmentUrl: string = requireCompartmentUrl(store);
  const loginFlowState: string = randomUUID();

  return {
    clearAppSession,
    kind: 'login_required',
    loginFlowState,
    loginUrl: buildCompartmentLoginUrl(compartmentUrl, host, path, loginFlowState),
    routeHost: host,
  };
}

function requireCompartmentUrl(store: EdgeAppAccessStateStore): string {
  const compartmentUrl: string | null = store.getCompartmentUrl();
  if (compartmentUrl === null) {
    throw new Error('Expected compartment URL when an app route is available.');
  }

  return compartmentUrl;
}

function buildCompartmentLoginUrl(compartmentUrl: string, host: string, path: string, state: string): string {
  const url: URL = new URL('/login', `${compartmentUrl}/`);
  url.searchParams.set('host', host);
  url.searchParams.set('path', sanitizeSafeRelativePath(path));
  url.searchParams.set('state', state);

  return url.toString();
}
