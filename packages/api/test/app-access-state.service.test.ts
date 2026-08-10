import type {
  AppAccessRouteState,
  AppAccessRouteAuthorizationState,
  AppAccessProxyRouteTargetState,
  AppAccessStateSnapshot,
  AccessAssignmentScopeType,
  PermissionKey,
} from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { type ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import type { listActiveCustomDeploymentRoutes } from '../src/queries/custom-deployment-routes.query';
import type { listActiveDeploymentRoutes } from '../src/queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../src/queries/deployment-routes.query.types';
import type { hasCompletedInstallation } from '../src/queries/install.query';
import type { listAllPrincipalPermissionGrantStates } from '../src/queries/rbac-assignments.query';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import { readAppAccessState } from '../src/services/app-access-state.service';
import { createApiTestConfig } from './api-config-test.fixtures';

type ListActiveDeploymentRoutes = typeof listActiveDeploymentRoutes;
type ListActiveCustomDeploymentRoutes = typeof listActiveCustomDeploymentRoutes;
type HasCompletedInstallation = typeof hasCompletedInstallation;
type ListAllPrincipalPermissionGrantStates = typeof listAllPrincipalPermissionGrantStates;

interface AppAccessStateServiceMocks {
  hasCompletedInstallation: Mock<HasCompletedInstallation>;
  listActiveCustomDeploymentRoutes: Mock<ListActiveCustomDeploymentRoutes>;
  listActiveDeploymentRoutes: Mock<ListActiveDeploymentRoutes>;
  listAllPrincipalPermissionGrantStates: Mock<ListAllPrincipalPermissionGrantStates>;
}

interface ExpectedProxyTargetOverrides extends Partial<AppAccessRouteAuthorizationState> {
  upstreamHost?: string | null | undefined;
  upstreamPort?: number | null | undefined;
}

const mocks: AppAccessStateServiceMocks = vi.hoisted(
  (): AppAccessStateServiceMocks => ({
    hasCompletedInstallation: vi.fn<HasCompletedInstallation>(),
    listActiveCustomDeploymentRoutes: vi.fn<ListActiveCustomDeploymentRoutes>(),
    listActiveDeploymentRoutes: vi.fn<ListActiveDeploymentRoutes>(),
    listAllPrincipalPermissionGrantStates: vi.fn<ListAllPrincipalPermissionGrantStates>(),
  }),
);

vi.mock(
  '../src/queries/custom-deployment-routes.query',
  (): {
    listActiveCustomDeploymentRoutes: Mock<ListActiveCustomDeploymentRoutes>;
  } => ({
    listActiveCustomDeploymentRoutes: mocks.listActiveCustomDeploymentRoutes,
  }),
);

vi.mock(
  '../src/queries/deployment-routes.query',
  (): {
    listActiveDeploymentRoutes: Mock<ListActiveDeploymentRoutes>;
  } => ({
    listActiveDeploymentRoutes: mocks.listActiveDeploymentRoutes,
  }),
);

vi.mock(
  '../src/queries/install.query',
  (): {
    hasCompletedInstallation: Mock<HasCompletedInstallation>;
  } => ({
    hasCompletedInstallation: mocks.hasCompletedInstallation,
  }),
);

vi.mock(
  '../src/queries/rbac-assignments.query',
  (): {
    listAllPrincipalPermissionGrantStates: Mock<ListAllPrincipalPermissionGrantStates>;
  } => ({
    listAllPrincipalPermissionGrantStates: mocks.listAllPrincipalPermissionGrantStates,
  }),
);

const apiConfig: ApiConfig = createApiTestConfig();

describe('app access state service', (): void => {
  beforeEach((): void => {
    configureApiRuntime({
      config: apiConfig,
      db: {} as Database,
    });
    mocks.hasCompletedInstallation.mockResolvedValue(true);
    mocks.listActiveCustomDeploymentRoutes.mockResolvedValue([]);
    mocks.listAllPrincipalPermissionGrantStates.mockResolvedValue([
      createGrantRow('org_123', 'organization', 'prn_123', 'app.route.access'),
    ]);
  });

  afterEach((): void => {
    clearApiRuntime();
    mocks.hasCompletedInstallation.mockReset();
    mocks.listActiveCustomDeploymentRoutes.mockReset();
    mocks.listActiveDeploymentRoutes.mockReset();
    mocks.listAllPrincipalPermissionGrantStates.mockReset();
  });

  it('compiles deployment-owned proxy rules into edge snapshot routes with resolved destination ports', async (): Promise<void> => {
    mocks.listActiveDeploymentRoutes.mockResolvedValue([
      createDeploymentRouteLookupRow({
        host: 'billing.localhost',
        resolvedRoutesJson: JSON.stringify([
          {
            methods: ['POST'],
            on: 'web',
            path: '/api/*',
            replacePrefix: '/internal',
            to: 'backoffice',
          },
          {
            on: 'web',
            path: '/health',
            rewrite: '/ready',
            to: 'web',
          },
        ]),
        upstreamPort: 31000,
        serviceId: 'svc_web',
        serviceName: 'web',
      }),
      createDeploymentRouteLookupRow({
        host: 'backoffice-billing.localhost',
        resolvedRoutesJson: '[]',
        upstreamPort: 31042,
        serviceId: 'svc_backoffice',
        serviceName: 'backoffice',
      }),
    ]);

    const state: AppAccessStateSnapshot = await readRequiredAppAccessState();

    expect(state.compartmentUrl).toBe('http://console.localhost:9080');
    expect(mocks.listActiveDeploymentRoutes).toHaveBeenCalledWith('localhost');
    const firstRoute: AppAccessRouteState = readRequiredRoute(state, 0);
    const secondRoute: AppAccessRouteState = readRequiredRoute(state, 1);

    expect(firstRoute.accessMode).toBe('authenticated');
    expect(firstRoute.proxyRoutes).toEqual([
      {
        methods: ['POST'],
        on: 'web',
        path: '/api/*',
        replacePrefix: '/internal',
        target: createExpectedProxyTarget({ upstreamPort: 31042 }),
        to: 'backoffice',
      },
      {
        on: 'web',
        path: '/health',
        rewrite: '/ready',
        target: createExpectedProxyTarget({ upstreamPort: 31000 }),
        to: 'web',
      },
    ]);
    expect(secondRoute.proxyRoutes).toEqual([]);
  });

  it('keeps matched proxy rules in the snapshot even when the destination service has no active route', async (): Promise<void> => {
    mocks.listActiveDeploymentRoutes.mockResolvedValue([
      createDeploymentRouteLookupRow({
        resolvedRoutesJson: JSON.stringify([
          {
            on: 'web',
            path: '/api/*',
            stripPrefix: '/api',
            to: 'backoffice',
          },
        ]),
        serviceId: 'svc_web',
        serviceName: 'web',
      }),
    ]);

    const state: AppAccessStateSnapshot = await readRequiredAppAccessState();

    const firstRoute: AppAccessRouteState = readRequiredRoute(state, 0);

    expect(firstRoute.proxyRoutes).toEqual([
      {
        on: 'web',
        path: '/api/*',
        stripPrefix: '/api',
        target: null,
        to: 'backoffice',
      },
    ]);
  });

  it('stores the target route access policy on compiled proxy rules', async (): Promise<void> => {
    mocks.listActiveDeploymentRoutes.mockResolvedValue([
      createDeploymentRouteLookupRow({
        accessMode: 'public',
        host: 'billing.localhost',
        resolvedRoutesJson: JSON.stringify([
          {
            on: 'web',
            path: '/api/*',
            stripPrefix: '/api',
            to: 'backoffice',
          },
        ]),
        serviceId: 'svc_web',
        serviceName: 'web',
      }),
      createDeploymentRouteLookupRow({
        accessMode: 'authenticated',
        accessScopeId: 'env_123',
        accessScopeType: 'environment',
        host: 'backoffice-billing.localhost',
        resolvedRoutesJson: '[]',
        serviceId: 'svc_backoffice',
        serviceName: 'backoffice',
      }),
    ]);

    const state: AppAccessStateSnapshot = await readRequiredAppAccessState();

    const firstRoute: AppAccessRouteState = readRequiredRoute(state, 0);

    expect(firstRoute.accessMode).toBe('public');
    expect(firstRoute.proxyRoutes).toEqual([
      {
        on: 'web',
        path: '/api/*',
        stripPrefix: '/api',
        target: createExpectedProxyTarget({
          routeScopeId: 'env_123',
          routeScopeType: 'environment',
          scopeChain: [
            { scopeId: 'env_123', scopeType: 'environment' },
            { scopeId: 'prj_123', scopeType: 'project' },
            { scopeId: 'org_123', scopeType: 'organization' },
          ],
        }),
        to: 'backoffice',
      },
    ]);
  });

  it('includes public route access mode in the edge snapshot', async (): Promise<void> => {
    mocks.listActiveDeploymentRoutes.mockResolvedValue([
      createDeploymentRouteLookupRow({
        accessMode: 'public',
        resolvedRoutesJson: '[]',
      }),
    ]);

    const state: AppAccessStateSnapshot = await readRequiredAppAccessState();

    const firstRoute: AppAccessRouteState = readRequiredRoute(state, 0);

    expect(firstRoute.accessMode).toBe('public');
  });

  it('includes verified custom domains as app routes', async (): Promise<void> => {
    mocks.listActiveDeploymentRoutes.mockResolvedValue([
      createDeploymentRouteLookupRow({
        host: 'billing.localhost',
        resolvedRoutesJson: '[]',
      }),
    ]);
    mocks.listActiveCustomDeploymentRoutes.mockResolvedValue([
      createDeploymentRouteLookupRow({
        host: 'app.example.com',
        resolvedRoutesJson: '[]',
      }),
    ]);

    const state: AppAccessStateSnapshot = await readRequiredAppAccessState();

    expect(state.routes.map((route: AppAccessRouteState): string => route.host)).toEqual([
      'billing.localhost',
      'app.example.com',
    ]);
    expect(mocks.listActiveCustomDeploymentRoutes).toHaveBeenCalledTimes(1);
  });

  it('returns no edge snapshot before installation completes', async (): Promise<void> => {
    mocks.hasCompletedInstallation.mockResolvedValue(false);

    await expect(readAppAccessState()).resolves.toBeNull();

    expect(mocks.listAllPrincipalPermissionGrantStates).not.toHaveBeenCalled();
    expect(mocks.listActiveDeploymentRoutes).not.toHaveBeenCalled();
  });

  it('groups duplicate permission rows into a single grant state', async (): Promise<void> => {
    mocks.listActiveDeploymentRoutes.mockResolvedValue([
      createDeploymentRouteLookupRow({
        resolvedRoutesJson: '[]',
      }),
    ]);
    mocks.listAllPrincipalPermissionGrantStates.mockResolvedValue([
      createGrantRow('org_123', 'organization', 'prn_123', 'project.read'),
      createGrantRow('org_123', 'organization', 'prn_123', 'project.read'),
      createGrantRow('org_123', 'organization', 'prn_123', 'app.route.access'),
    ]);

    const state: AppAccessStateSnapshot = await readRequiredAppAccessState();

    expect(state.grants).toEqual([
      {
        permissions: ['project.read', 'app.route.access'],
        principalId: 'prn_123',
        scopeId: 'org_123',
        scopeType: 'organization',
      },
    ]);
  });

  it('builds environment to project to organization scope chains for route authorization', async (): Promise<void> => {
    mocks.listActiveDeploymentRoutes.mockResolvedValue([
      createDeploymentRouteLookupRow({
        accessScopeId: 'env_123',
        accessScopeType: 'environment',
        resolvedRoutesJson: '[]',
      }),
    ]);

    const state: AppAccessStateSnapshot = await readRequiredAppAccessState();

    expect(readRequiredRoute(state, 0).scopeChain).toEqual([
      { scopeId: 'env_123', scopeType: 'environment' },
      { scopeId: 'prj_123', scopeType: 'project' },
      { scopeId: 'org_123', scopeType: 'organization' },
    ]);
  });
});

async function readRequiredAppAccessState(): Promise<AppAccessStateSnapshot> {
  const state: AppAccessStateSnapshot | null = await readAppAccessState();
  if (state === null) {
    throw new Error('Expected app access state snapshot.');
  }

  return state;
}

function readRequiredRoute(state: AppAccessStateSnapshot, index: number): AppAccessRouteState {
  const route: AppAccessRouteState | undefined = state.routes[index];
  if (route === undefined) {
    throw new Error(`Expected route at index ${index.toString()}.`);
  }

  return route;
}

function createGrantRow(
  scopeId: string,
  scopeType: AccessAssignmentScopeType,
  principalId: string,
  permissionKey: PermissionKey,
): {
  permissionKey: PermissionKey;
  principalId: string;
  scopeId: string;
  scopeType: AccessAssignmentScopeType;
} {
  return {
    permissionKey,
    principalId,
    scopeId,
    scopeType,
  };
}

function createDeploymentRouteLookupRow(
  overrides: Partial<DeploymentRouteLookupRow> & Pick<DeploymentRouteLookupRow, 'resolvedRoutesJson'>,
): DeploymentRouteLookupRow {
  const { resolvedRoutesJson, ...remainingOverrides } = overrides;

  return {
    accessMode: 'authenticated',
    accessScopeId: 'org_123',
    accessScopeType: 'organization',
    deploymentId: 'dep_123',
    environmentId: 'env_123',
    environmentName: 'production',
    host: 'billing.localhost',
    organizationId: 'org_123',
    organizationSlug: 'acme-dev',
    projectId: 'prj_123',
    projectName: 'billing',
    resolvedRoutesJson,
    serviceId: 'svc_web',
    serviceName: 'web',
    upstreamHost: '127.0.0.1',
    upstreamPort: 31000,
    ...remainingOverrides,
  };
}

function createExpectedProxyTarget(overrides: ExpectedProxyTargetOverrides = {}): AppAccessProxyRouteTargetState {
  const authorizationState: AppAccessRouteAuthorizationState = {
    accessMode: overrides.accessMode ?? 'authenticated',
    routeScopeId: overrides.routeScopeId ?? 'org_123',
    routeScopeType: overrides.routeScopeType ?? 'organization',
    scopeChain: overrides.scopeChain ?? [{ scopeId: 'org_123', scopeType: 'organization' }],
  };

  if (overrides.upstreamHost === null || overrides.upstreamPort === null) {
    return {
      ...authorizationState,
      upstreamHost: null,
      upstreamPort: null,
    };
  }

  return {
    ...authorizationState,
    upstreamHost: overrides.upstreamHost ?? '127.0.0.1',
    upstreamPort: overrides.upstreamPort ?? 31000,
  };
}
