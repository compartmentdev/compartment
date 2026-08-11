import {
  isDeployableCompartmentServiceKind,
  resolveCompartmentServiceBuildConfig,
  resolveCompartmentEnvironmentName,
  resolveCompartmentServiceKind,
  resolveCompartmentServiceReleaseConfig,
  resolveCompartmentServiceRunConfig,
  resolveServiceReadinessConfig,
  defaultApplicationPorts,
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredService,
  type CompartmentAuthoredServiceConfig,
  type CompartmentServiceReadinessConfig,
  type CompartmentServiceKind,
} from '@compartment/contracts';
import {
  createDeploymentNotFoundError,
  createDescriptorServiceNotFoundError,
  createServiceNotFoundError,
  createUnsupportedServiceKindError,
} from '../errors/api-business-error';
import { findEnvironmentByProjectAndName, findProjectServiceByName } from '../queries/deployment-context.query';
import type { DeploymentJoinedRow, EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import type {
  ResolvedDescriptorService,
  ResolvedEnvironmentContext,
  ResolvedExistingBuildTargetContext,
} from './deployments.service.types';

export { resolveCompartmentEnvironmentName as resolveEnvironmentName };

export function resolveDescriptorServices(
  descriptor: CompartmentAuthoredDescriptor,
  requestedServiceName: string | undefined,
): ResolvedDescriptorService[] {
  if (requestedServiceName !== undefined) {
    const requestedService: CompartmentAuthoredService | undefined = descriptor.services[requestedServiceName];
    if (requestedService === undefined) {
      throw createDescriptorServiceNotFoundError();
    }

    return [normalizeDescriptorService(requestedServiceName, requestedService)];
  }

  return Object.entries(descriptor.services).map(
    ([serviceName, service]: [string, CompartmentAuthoredService]): ResolvedDescriptorService =>
      normalizeDescriptorService(serviceName, service),
  );
}

export function requireEnvironmentScopedDeployment(
  deployment: DeploymentJoinedRow | undefined,
  context: ResolvedEnvironmentContext,
  serviceName?: string,
): DeploymentJoinedRow {
  const joinedDeployment: DeploymentJoinedRow = requireJoinedDeployment(deployment);
  if (
    joinedDeployment.environment.id !== context.environment.id ||
    joinedDeployment.project.id !== context.project.id ||
    (serviceName !== undefined && joinedDeployment.service.name !== serviceName)
  ) {
    throw createDeploymentNotFoundError();
  }

  return joinedDeployment;
}

export function requireJoinedDeployment(deployment: DeploymentJoinedRow | undefined): DeploymentJoinedRow {
  if (deployment === undefined) {
    throw createDeploymentNotFoundError();
  }

  return deployment;
}

export function requireProjectService(service: ProjectServiceRow | undefined): ProjectServiceRow {
  if (service === undefined) {
    throw createServiceNotFoundError();
  }

  return service;
}

export async function readExistingBuildTargetContext(
  organizationId: string,
  projectId: string,
  environmentName: string,
  serviceName: string,
): Promise<ResolvedExistingBuildTargetContext> {
  const environment: EnvironmentRow | undefined = await findEnvironmentByProjectAndName(projectId, environmentName);
  const service: ProjectServiceRow | undefined = await findProjectServiceByName(projectId, serviceName);

  return {
    environmentId: environment?.id ?? null,
    organizationId,
    serviceId: service?.id ?? null,
  };
}

export function readEmptyBuildTargetContext(): ResolvedExistingBuildTargetContext {
  return {
    environmentId: null,
    organizationId: null,
    serviceId: null,
  };
}

function normalizeDescriptorService(
  serviceName: string,
  service: CompartmentAuthoredService,
): ResolvedDescriptorService {
  if (typeof service === 'string') {
    return {
      build: resolveCompartmentServiceBuildConfig(undefined),
      connections: {},
      kind: resolveCompartmentServiceKind(undefined),
      name: serviceName,
      path: service,
      ports: [...defaultApplicationPorts],
      readiness: resolveServiceReadinessConfig(undefined),
      release: resolveCompartmentServiceReleaseConfig(undefined),
      run: resolveCompartmentServiceRunConfig(undefined),
    };
  }

  return normalizeDescriptorServiceConfig(serviceName, service);
}

function normalizeDescriptorServiceConfig(
  serviceName: string,
  service: CompartmentAuthoredServiceConfig,
): ResolvedDescriptorService {
  const readiness: CompartmentServiceReadinessConfig | undefined = service.readiness;

  return {
    ...(service.accessMode !== undefined ? { accessMode: service.accessMode } : {}),
    build: resolveCompartmentServiceBuildConfig(service.build),
    connections: service.connections ?? {},
    kind: requireDeployableServiceKind(service.kind),
    name: serviceName,
    path: service.path,
    ports: service.ports ?? [...defaultApplicationPorts],
    readiness: resolveServiceReadinessConfig(readiness),
    release: resolveCompartmentServiceReleaseConfig(service.release),
    run: resolveCompartmentServiceRunConfig(service.run),
  };
}

function requireDeployableServiceKind(kind: CompartmentServiceKind | undefined): CompartmentServiceKind {
  const resolvedKind: CompartmentServiceKind = resolveCompartmentServiceKind(kind);
  if (isDeployableCompartmentServiceKind(resolvedKind)) {
    return resolvedKind;
  }

  throw createUnsupportedServiceKindError();
}
