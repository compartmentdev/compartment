import type {
  AppAccessGrantState,
  AppAccessProxyRouteState,
  AppAccessProxyRouteTargetState,
  AppAccessRouteAuthorizationState,
  AppAccessRouteState,
  AppAccessScopeReference,
  AppAccessStateSnapshot,
  CompartmentRouteRule,
} from '@compartment/contracts';
import { listActiveCustomDeploymentRoutes } from '../queries/custom-deployment-routes.query';
import {
  findActiveDeploymentRouteByEnvironmentServiceName,
  findActiveDeploymentRouteByHost,
  listActiveDeploymentRoutes,
} from '../queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../queries/deployment-routes.query.types';
import { hasCompletedInstallation } from '../queries/install.query';
import { listAllPrincipalPermissionGrantStates } from '../queries/rbac-assignments.query';
import type { AllPrincipalPermissionGrantStateRow } from '../queries/rbac.query.types';
import type { ApiConfig } from '../config';
import { getApiConfig } from '../runtime/runtime-access';
import { parseSerializedCompartmentRoutes } from './compartment-routes.service';
import { readDeploymentUpstreamHost } from './deployment-upstream.service';
import { buildRuntimePublicSettings } from './public-hosts.service';
import type {
  AppAccessRouteStateContext,
  AppAccessRouteStateTargetRoutesInput,
  DeploymentRouteStateInput,
  RouteScopeChainInput,
} from './app-access-state.service.types';

export async function readAppAccessState(): Promise<AppAccessStateSnapshot | null> {
  if (!(await hasCompletedInstallation())) {
    return null;
  }

  const config: ApiConfig = getApiConfig();
  const routeStateContext: AppAccessRouteStateContext = await readAppAccessRouteStateContext(config.baseDomain);

  return {
    grants: await readGrantStates(),
    compartmentUrl: buildRuntimePublicSettings(config).compartmentUrl,
    onDemandTlsHosts: readOnDemandTlsHosts(routeStateContext.customRoutes),
    routes: routeStateContext.routes,
  };
}

async function readAppAccessRouteStateContext(baseDomain: string): Promise<AppAccessRouteStateContext> {
  const customRoutes: DeploymentRouteLookupRow[] = await listActiveCustomDeploymentRoutes();

  return {
    customRoutes,
    routes: await readAppAccessRouteStates(baseDomain, customRoutes),
  };
}

async function readAppAccessRouteStates(
  baseDomain: string,
  customRoutes: DeploymentRouteLookupRow[],
): Promise<AppAccessRouteState[]> {
  const canonicalRoutes: DeploymentRouteLookupRow[] = await listActiveDeploymentRoutes(baseDomain);
  const routes: DeploymentRouteLookupRow[] = [...canonicalRoutes, ...customRoutes];

  return routes.map(
    (route: DeploymentRouteLookupRow): AppAccessRouteState =>
      readAppAccessRouteStateFromTargetRoutes({
        route,
        targetRoutes: routes,
      }),
  );
}

export async function readAppAccessRouteStateByHost(
  host: string,
  baseDomain: string,
): Promise<AppAccessRouteState | null> {
  const route: DeploymentRouteLookupRow | undefined = await findActiveDeploymentRouteByHost(host, baseDomain);
  if (route === undefined) {
    return null;
  }
  const targetRoutes: DeploymentRouteLookupRow[] = await listActiveAppAccessRouteProxyTargetRoutes(route, baseDomain);

  return readAppAccessRouteStateFromTargetRoutes({
    route,
    targetRoutes: [...targetRoutes, route],
  });
}

async function readGrantStates(): Promise<AppAccessGrantState[]> {
  const rows: AllPrincipalPermissionGrantStateRow[] = await listAllPrincipalPermissionGrantStates();
  const groupedPermissions: Map<string, AppAccessGrantState> = new Map<string, AppAccessGrantState>();

  for (const row of rows) {
    const key: string = `${row.principalId}:${row.scopeType}:${row.scopeId}`;
    const existing: AppAccessGrantState | undefined = groupedPermissions.get(key);
    if (existing === undefined) {
      groupedPermissions.set(key, {
        permissions: [row.permissionKey],
        principalId: row.principalId,
        scopeId: row.scopeId,
        scopeType: row.scopeType,
      });
      continue;
    }

    if (!existing.permissions.includes(row.permissionKey)) {
      existing.permissions.push(row.permissionKey);
    }
  }

  return [...groupedPermissions.values()];
}

function readOnDemandTlsHosts(customRoutes: DeploymentRouteLookupRow[]): string[] {
  return customRoutes.map((route: DeploymentRouteLookupRow): string => route.host);
}

async function listActiveAppAccessRouteProxyTargetRoutes(
  route: DeploymentRouteLookupRow,
  baseDomain: string,
): Promise<DeploymentRouteLookupRow[]> {
  const targetServiceNames: Set<string> = readAppAccessRouteProxyTargetServiceNames(route);
  const routes: (DeploymentRouteLookupRow | undefined)[] = await Promise.all(
    [...targetServiceNames].map(
      async (serviceName: string): Promise<DeploymentRouteLookupRow | undefined> =>
        await findActiveDeploymentRouteByEnvironmentServiceName(route.environmentId, serviceName, baseDomain),
    ),
  );

  return routes.filter(isDeploymentRouteLookupRow);
}

function readAppAccessRouteStateFromTargetRoutes(input: AppAccessRouteStateTargetRoutesInput): AppAccessRouteState {
  const targetsByEnvironmentService: Map<string, AppAccessProxyRouteTargetState> = buildTargetsByEnvironmentService(
    input.targetRoutes,
  );

  return toAppAccessRouteState({
    proxyRoutes: buildProxyRoutes(input.route, targetsByEnvironmentService),
    ...input.route,
    scopeChain: buildRouteScopeChain(input.route),
  });
}

function toAppAccessRouteState(input: DeploymentRouteStateInput): AppAccessRouteState {
  return {
    accessMode: input.accessMode,
    host: input.host,
    organizationId: input.organizationId,
    organizationSlug: input.organizationSlug,
    proxyRoutes: input.proxyRoutes,
    routeScopeId: input.accessScopeId,
    routeScopeType: input.accessScopeType,
    scopeChain: input.scopeChain,
    upstreamHost: readDeploymentUpstreamHost(input.upstreamHost),
    upstreamPort: requireRoutePort(input),
  };
}

function readAppAccessRouteProxyTargetServiceNames(route: DeploymentRouteLookupRow): Set<string> {
  return new Set(
    parseSerializedCompartmentRoutes(route.resolvedRoutesJson).map(
      (proxyRoute: CompartmentRouteRule): string => proxyRoute.to,
    ),
  );
}

function isDeploymentRouteLookupRow(route: DeploymentRouteLookupRow | undefined): route is DeploymentRouteLookupRow {
  return route !== undefined;
}

function buildTargetsByEnvironmentService(
  routes: DeploymentRouteLookupRow[],
): Map<string, AppAccessProxyRouteTargetState> {
  const targetsByEnvironmentService: Map<string, AppAccessProxyRouteTargetState> = new Map<
    string,
    AppAccessProxyRouteTargetState
  >();

  for (const route of routes) {
    targetsByEnvironmentService.set(
      readEnvironmentServiceKey(route.environmentId, route.serviceName),
      buildAppAccessProxyRouteTargetState(route),
    );
  }

  return targetsByEnvironmentService;
}

function buildProxyRoutes(
  route: DeploymentRouteLookupRow,
  targetsByEnvironmentService: Map<string, AppAccessProxyRouteTargetState>,
): AppAccessProxyRouteState[] {
  return parseSerializedCompartmentRoutes(route.resolvedRoutesJson).map(
    (proxyRoute: CompartmentRouteRule): AppAccessProxyRouteState =>
      buildAppAccessProxyRouteState(route.environmentId, proxyRoute, targetsByEnvironmentService),
  );
}

function buildAppAccessProxyRouteState(
  environmentId: string,
  proxyRoute: CompartmentRouteRule,
  targetsByEnvironmentService: Map<string, AppAccessProxyRouteTargetState>,
): AppAccessProxyRouteState {
  const target: AppAccessProxyRouteTargetState | undefined = targetsByEnvironmentService.get(
    readEnvironmentServiceKey(environmentId, proxyRoute.to),
  );

  return {
    ...proxyRoute,
    target: target ?? null,
  };
}

function buildAppAccessProxyRouteTargetState(route: DeploymentRouteLookupRow): AppAccessProxyRouteTargetState {
  const authorizationState: AppAccessRouteAuthorizationState = {
    accessMode: route.accessMode,
    routeScopeId: route.accessScopeId,
    routeScopeType: route.accessScopeType,
    scopeChain: buildRouteScopeChain(route),
  };

  if (route.upstreamPort === null) {
    return {
      ...authorizationState,
      upstreamHost: null,
      upstreamPort: null,
    };
  }

  return {
    ...authorizationState,
    upstreamHost: readDeploymentUpstreamHost(route.upstreamHost),
    upstreamPort: route.upstreamPort,
  };
}

function requireRoutePort(route: DeploymentRouteLookupRow): number {
  if (route.upstreamPort === null) {
    throw new Error(`Active route ${route.host} is missing a route port.`);
  }

  return route.upstreamPort;
}

function buildRouteScopeChain(input: RouteScopeChainInput): AppAccessScopeReference[] {
  switch (input.accessScopeType) {
    case 'organization':
      return [{ scopeId: input.organizationId, scopeType: 'organization' }];
    case 'project':
      return [
        { scopeId: input.projectId, scopeType: 'project' },
        { scopeId: input.organizationId, scopeType: 'organization' },
      ];
    case 'environment':
      return [
        { scopeId: input.environmentId, scopeType: 'environment' },
        { scopeId: input.projectId, scopeType: 'project' },
        { scopeId: input.organizationId, scopeType: 'organization' },
      ];
  }
}

function readEnvironmentServiceKey(environmentId: string, serviceName: string): string {
  return `${environmentId}:${serviceName}`;
}
