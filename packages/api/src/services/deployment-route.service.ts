import {
  findLatestReservedDeploymentRouteSubdomainForOwner,
  listDeploymentRouteSubdomains,
  tryInsertDeploymentRouteWithExecutor,
} from '../queries/deployment-routes.query';
import { buildPublicRouteHost, readPublicRouteSubdomain } from '../lib/public-route-host';
import { createId } from '../lib/tokens';
import type { DeploymentRow } from '../queries/deployments.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import type {
  DeploymentRouteQueryExecutor,
  UpsertDeploymentRouteInput,
} from '../queries/deployment-routes.query.types';
import type {
  DeploymentPublicRoute,
  DeploymentPublicRouteContext,
  DeploymentPublicRouteReservationContext,
} from './deployment-route.service.types';
import { buildCanonicalRouteHost } from './public-hosts.service';

const primaryPublicServiceName: string = 'web';
const maxRouteReservationRetries: number = 64;

export async function resolveDeploymentPublicRoute(
  input: DeploymentPublicRouteContext,
): Promise<DeploymentPublicRoute> {
  const baseDomain: string = getApiConfig().baseDomain;
  const attachedRoute: DeploymentPublicRoute | null = readAttachedDeploymentPublicRoute(input.deployment.deployment);
  if (attachedRoute !== null) {
    return attachedRoute;
  }

  const reservedRoute: DeploymentPublicRoute | null = await readReservedDeploymentPublicRoute(
    baseDomain,
    input.deployment.environment.id,
    input.deployment.service.id,
  );
  if (reservedRoute !== null) {
    return reservedRoute;
  }

  return await createCanonicalDeploymentPublicRoute(input, baseDomain);
}

export async function reserveDeploymentPublicRouteWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  input: DeploymentPublicRouteReservationContext,
): Promise<DeploymentPublicRoute> {
  const baseDomain: string = getApiConfig().baseDomain;
  const reservedRoute: DeploymentPublicRoute | null = await readReservedDeploymentPublicRoute(
    baseDomain,
    input.environmentId,
    input.serviceId,
  );
  if (reservedRoute !== null) {
    return reservedRoute;
  }

  return await reserveCanonicalDeploymentPublicRouteWithExecutor(executor, input, baseDomain);
}

async function createCanonicalDeploymentPublicRoute(
  input: DeploymentPublicRouteContext,
  baseDomain: string,
): Promise<DeploymentPublicRoute> {
  return buildCanonicalDeploymentPublicRoute(
    {
      deploymentId: input.deployment.deployment.id,
      environmentId: input.deployment.environment.id,
      environmentName: input.deployment.environment.name,
      organizationId: input.deployment.project.organizationId,
      projectName: input.deployment.project.name,
      serviceId: input.deployment.service.id,
      serviceName: input.deployment.service.name,
      updatedAt: input.deployment.deployment.updatedAt,
    },
    baseDomain,
    await listReservedRouteHosts(baseDomain),
  );
}

async function reserveCanonicalDeploymentPublicRouteWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  input: DeploymentPublicRouteReservationContext,
  baseDomain: string,
): Promise<DeploymentPublicRoute> {
  const existingHosts: Set<string> = await listReservedRouteHosts(baseDomain);

  for (let reservationAttempt: number = 0; reservationAttempt < maxRouteReservationRetries; reservationAttempt += 1) {
    const reservedRoute: DeploymentPublicRoute | null = await tryReserveCanonicalDeploymentPublicRouteWithExecutor(
      executor,
      input,
      baseDomain,
      existingHosts,
    );
    if (reservedRoute !== null) {
      return reservedRoute;
    }
  }

  throw new Error('Could not allocate a unique public route host.');
}

async function tryReserveCanonicalDeploymentPublicRouteWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  input: DeploymentPublicRouteReservationContext,
  baseDomain: string,
  existingHosts: Set<string>,
): Promise<DeploymentPublicRoute | null> {
  const publicRoute: DeploymentPublicRoute = buildCanonicalDeploymentPublicRoute(input, baseDomain, existingHosts);
  const inserted: boolean = await tryInsertDeploymentRouteWithExecutor(
    executor,
    buildDeploymentRouteReservationInput(input, publicRoute),
  );
  if (inserted) {
    return publicRoute;
  }

  const reusedRoute: DeploymentPublicRoute | null = await readReservedDeploymentPublicRoute(
    baseDomain,
    input.environmentId,
    input.serviceId,
  );
  if (reusedRoute !== null) {
    return reusedRoute;
  }

  existingHosts.add(publicRoute.routeHost);
  return null;
}

async function listReservedRouteHosts(baseDomain: string): Promise<Set<string>> {
  return new Set<string>(
    (await listDeploymentRouteSubdomains()).map((routeSubdomain: string): string =>
      buildPublicRouteHost(baseDomain, routeSubdomain),
    ),
  );
}

function buildDeploymentRouteReservationInput(
  input: DeploymentPublicRouteReservationContext,
  publicRoute: DeploymentPublicRoute,
): UpsertDeploymentRouteInput {
  return {
    accessScopeId: input.organizationId,
    accessScopeType: 'organization',
    deploymentId: input.deploymentId,
    environmentId: input.environmentId,
    id: createId('rte'),
    serviceId: input.serviceId,
    subdomain: publicRoute.routeSubdomain,
    updatedAt: input.updatedAt,
  };
}

function readAttachedDeploymentPublicRoute(deployment: DeploymentRow): DeploymentPublicRoute | null {
  if (deployment.routeHost === null || deployment.routeBaseDomain === null) {
    return null;
  }

  return {
    routeHost: deployment.routeHost,
    routeSubdomain: requireRouteSubdomain(deployment.routeHost, deployment.routeBaseDomain),
  };
}

async function readReservedDeploymentPublicRoute(
  baseDomain: string,
  environmentId: string,
  serviceId: string,
): Promise<DeploymentPublicRoute | null> {
  const storedRouteSubdomain: string | undefined = await findLatestReservedDeploymentRouteSubdomainForOwner(
    environmentId,
    serviceId,
  );
  if (storedRouteSubdomain === undefined) {
    return null;
  }

  return {
    routeHost: buildPublicRouteHost(baseDomain, storedRouteSubdomain),
    routeSubdomain: storedRouteSubdomain,
  };
}

function buildCanonicalDeploymentPublicRoute(
  input: DeploymentPublicRouteReservationContext,
  baseDomain: string,
  existingHosts: Set<string>,
): DeploymentPublicRoute {
  const routeHost: string = buildCanonicalRouteHost({
    baseDomain,
    environmentName: input.environmentName,
    existingHosts: [...existingHosts],
    includeServiceLabel: input.serviceName !== primaryPublicServiceName,
    organizationId: input.organizationId,
    projectName: input.projectName,
    serviceName: input.serviceName,
  });

  return {
    routeHost,
    routeSubdomain: requireRouteSubdomain(routeHost, baseDomain),
  };
}

function requireRouteSubdomain(routeHost: string, baseDomain: string): string {
  const routeSubdomain: string | null = readPublicRouteSubdomain(routeHost, baseDomain);
  if (routeSubdomain === null) {
    throw new Error(`Expected route host ${routeHost} to belong to ${baseDomain}.`);
  }

  return routeSubdomain;
}
