import { resolveCompartmentEnvironmentName } from '@compartment/contracts';
import type { StatusLookupInput } from '../../services/deployments.service.types';
import type { DeploymentQueryRouteQuery } from './deployment-query-route.types';

interface DeploymentQueryRouteActorContext {
  organizationSlug: string;
  principalId: string;
}

interface StatusLookupBaseInput {
  environmentName: string;
  organizationSlug: string;
  principalId: string;
  projectName: string;
}

export function buildStatusLookupInput<TQuery extends DeploymentQueryRouteQuery>(
  query: TQuery,
  context: DeploymentQueryRouteActorContext,
): StatusLookupInput {
  const baseInput: StatusLookupBaseInput = buildStatusLookupBaseInput(query, context);
  if (query.deploymentId !== undefined) {
    return buildDeploymentStatusLookupInput(baseInput, query.deploymentId, query.serviceName);
  }
  if (query.serviceName !== undefined) {
    return buildServiceStatusLookupInput(baseInput, query.serviceName);
  }

  return buildEnvironmentStatusLookupInput(baseInput);
}

function buildStatusLookupBaseInput<TQuery extends DeploymentQueryRouteQuery>(
  query: TQuery,
  context: DeploymentQueryRouteActorContext,
): StatusLookupBaseInput {
  return {
    environmentName: resolveCompartmentEnvironmentName(query.environmentName),
    organizationSlug: context.organizationSlug,
    principalId: context.principalId,
    projectName: query.projectName,
  };
}

function buildDeploymentStatusLookupInput(
  baseInput: StatusLookupBaseInput,
  deploymentId: string,
  serviceName: string | undefined,
): StatusLookupInput {
  return {
    ...baseInput,
    deploymentId,
    mode: 'deployment',
    serviceName,
  };
}

function buildServiceStatusLookupInput(baseInput: StatusLookupBaseInput, serviceName: string): StatusLookupInput {
  return {
    ...baseInput,
    mode: 'service',
    serviceName,
  };
}

function buildEnvironmentStatusLookupInput(baseInput: StatusLookupBaseInput): StatusLookupInput {
  return {
    ...baseInput,
    mode: 'environment',
  };
}
