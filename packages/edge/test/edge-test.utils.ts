import {
  listCompartmentRolePermissions,
  type AppRouteAccessMode,
  type AppAccessExchangeResponse,
  type AppAccessGrantState,
  type AppAccessProxyRouteState,
  type AppAccessProxyRouteTargetState,
  type AppAccessRouteAuthorizationState,
  type AppAccessSessionState,
  type AppAccessStateSnapshot,
} from '@compartment/contracts';
import { readCookieValue } from '@compartment/utils';
import { createEdgeApp } from '../src/app';
import type { EdgeApp } from '../src/app.types';
import type { EdgeConfig } from '../src/config';
import type { EdgeAppAccessStateStore } from '../src/services/app-access-state-store.service.types';

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type RequestInitBody = ReadableStream | URLSearchParams | Uint8Array | string;

interface CreateEdgeTestAppInput {
  config?: Partial<EdgeConfig> | undefined;
  sessions?: EdgeSessionSeed[] | undefined;
  snapshot?: AppAccessStateSnapshot | undefined;
}

interface EdgeSessionSeed {
  session: AppAccessSessionState;
  token: string;
}

interface EdgeTestAppResult {
  app: EdgeApp;
  store: EdgeAppAccessStateStore;
}

type TestRouteScopeType = 'environment' | 'organization' | 'project';
interface AppAccessSnapshotScopeReference {
  scopeId: string;
  scopeType: TestRouteScopeType;
}
type AppAccessStateSnapshotRouteScopeChain = AppAccessSnapshotScopeReference[];

export interface AppAccessExchangeRequestBody {
  code: string;
  host: string;
  state: string;
}

export function createEdgeTestApp(input: CreateEdgeTestAppInput = {}): EdgeTestAppResult {
  const app: EdgeApp = createEdgeApp({
    config: createEdgeConfig(input.config),
  });
  const store: EdgeAppAccessStateStore = app.edgeStore;
  if (input.snapshot !== undefined) {
    store.replaceSnapshot(input.snapshot);
  }
  for (const session of input.sessions ?? []) {
    store.setSession(session.token, session.session);
  }

  return {
    app,
    store,
  };
}

function createEdgeConfig(overrides: Partial<EdgeConfig> | undefined = undefined): EdgeConfig {
  return {
    apiUrl: 'http://127.0.0.1:9443',
    bindHost: overrides?.bindHost ?? '127.0.0.1',
    edgeToken: 'test-edge-token',
    internalHost: overrides?.internalHost ?? '127.0.0.1',
    logLevel: 'silent',
    controlPlaneHost: 'console.localhost',
    port: 9081,
    publicProtocol: 'http',
    snapshotMaxAgeMs: 86_400_000,
    snapshotPath: '/tmp/compartment-edge-test/access-state.json',
    ...overrides,
  };
}

export function createAppAccessSnapshot(
  input: {
    accessMode?: AppRouteAccessMode | undefined;
    host?: string | undefined;
    grants?: AppAccessGrantState[] | undefined;
    compartmentUrl?: string | undefined;
    proxyRoutes?: AppAccessProxyRouteState[] | undefined;
    routeScopeId?: string | undefined;
    routeScopeType?: TestRouteScopeType | undefined;
    scopeChain?: AppAccessStateSnapshotRouteScopeChain | undefined;
    upstreamHost?: string | undefined;
    upstreamPort?: number | undefined;
  } = {},
): AppAccessStateSnapshot {
  const routeScopeType: TestRouteScopeType = input.routeScopeType ?? 'organization';
  const routeScopeId: string = input.routeScopeId ?? createRouteScopeId(routeScopeType);

  return {
    grants: input.grants ?? [
      {
        principalId: 'prn_123',
        permissions: listCompartmentRolePermissions('admin'),
        scopeId: 'org_123',
        scopeType: 'organization',
      },
    ],
    compartmentUrl: input.compartmentUrl ?? 'http://console.localhost:9080',
    routes: [
      {
        accessMode: input.accessMode ?? 'authenticated',
        host: input.host ?? 'billing.localhost',
        organizationId: 'org_123',
        organizationSlug: 'acme-dev',
        proxyRoutes: input.proxyRoutes ?? [],
        upstreamHost: input.upstreamHost ?? 'app.cpt-project.svc',
        upstreamPort: input.upstreamPort ?? 31000,
        routeScopeId,
        routeScopeType,
        scopeChain: input.scopeChain ?? createScopeChain(routeScopeType, routeScopeId),
      },
    ],
  };
}

export function createAppSessionState(
  input: {
    expiresAt?: string | undefined;
    host?: string | undefined;
  } = {},
): AppAccessSessionState {
  return {
    authSessionId: 'auth_123',
    expiresAt: input.expiresAt ?? '2099-03-31T00:00:00.000Z',
    host: input.host ?? 'billing.localhost',
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    principalType: 'user',
  };
}

export function createAppAccessProxyRouteTargetState(
  input: {
    accessMode?: AppRouteAccessMode | undefined;
    routeScopeId?: string | undefined;
    routeScopeType?: TestRouteScopeType | undefined;
    scopeChain?: AppAccessStateSnapshotRouteScopeChain | undefined;
    upstreamHost?: string | null | undefined;
    upstreamPort?: number | null | undefined;
  } = {},
): AppAccessProxyRouteTargetState {
  const routeScopeType: TestRouteScopeType = input.routeScopeType ?? 'organization';
  const routeScopeId: string = input.routeScopeId ?? createRouteScopeId(routeScopeType);
  const authorizationState: AppAccessRouteAuthorizationState = {
    accessMode: input.accessMode ?? 'authenticated',
    routeScopeId,
    routeScopeType,
    scopeChain: input.scopeChain ?? createScopeChain(routeScopeType, routeScopeId),
  };

  if (input.upstreamHost === null || input.upstreamPort === null) {
    return {
      ...authorizationState,
      upstreamHost: null,
      upstreamPort: null,
    };
  }

  return {
    ...authorizationState,
    upstreamHost: input.upstreamHost ?? 'app.cpt-project.svc',
    upstreamPort: input.upstreamPort ?? 31042,
  };
}

export function createJsonResponse<TPayload>(payload: TPayload): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
    },
    status: 200,
  });
}

export function createAppAccessExchangeResponse(): AppAccessExchangeResponse {
  return {
    appSessionToken: 'app-session-token',
    redirectPath: '/dashboard',
    session: createAppSessionState(),
  };
}

export function readFetchUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

async function readRequestInitBody(init: RequestInit | undefined): Promise<string> {
  const body: RequestInitBody | null | undefined = init?.body as RequestInitBody | null | undefined;
  if (body === undefined || body === null) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }

  return await new Response(body).text();
}

export async function readJsonRequestInitBody<TPayload>(init: RequestInit | undefined): Promise<TPayload> {
  return JSON.parse(await readRequestInitBody(init)) as TPayload;
}

export function requireSetCookieValue(header: string | string[] | undefined, cookieName: string): string {
  const cookieHeader: string = requireSetCookieHeader(header, cookieName);
  const cookieValue: string | undefined = readCookieValue(cookieHeader, cookieName);
  if (cookieValue === undefined || cookieValue === '') {
    throw new Error(`Expected cookie value for "${cookieName}".`);
  }

  return cookieValue;
}

export function requireSetCookieHeader(header: string | string[] | undefined, cookieName: string): string {
  let values: string[] = [];
  if (Array.isArray(header)) {
    values = header;
  } else if (header !== undefined) {
    values = [header];
  }
  const cookiePrefix: string = `${cookieName}=`;
  const cookieHeader: string | undefined = values.find((value: string): boolean => value.startsWith(cookiePrefix));
  if (cookieHeader === undefined) {
    throw new Error(`Expected Set-Cookie for "${cookieName}".`);
  }

  return cookieHeader;
}

function createScopeChain(
  routeScopeType: TestRouteScopeType,
  routeScopeId: string,
): AppAccessStateSnapshotRouteScopeChain {
  switch (routeScopeType) {
    case 'organization':
      return [{ scopeId: routeScopeId, scopeType: 'organization' }];
    case 'project':
      return [
        { scopeId: routeScopeId, scopeType: 'project' },
        { scopeId: 'org_123', scopeType: 'organization' },
      ];
    case 'environment':
      return [
        { scopeId: routeScopeId, scopeType: 'environment' },
        { scopeId: 'prj_123', scopeType: 'project' },
        { scopeId: 'org_123', scopeType: 'organization' },
      ];
  }
}

function createRouteScopeId(routeScopeType: TestRouteScopeType): string {
  if (routeScopeType === 'environment') {
    return 'env_123';
  }
  if (routeScopeType === 'project') {
    return 'prj_123';
  }

  return 'org_123';
}
