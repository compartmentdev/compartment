import { buildDockerNamespaceLabels } from '@compartment/docker';
import type { NodeDeployRequest, NodeReleaseRequest } from '@compartment/contracts';
import type { ResolvedRuntimeDeploymentContext } from './runtime.types';

export const deploymentIdLabelName: string = 'compartment.deploymentId';
export const environmentIdLabelName: string = 'compartment.environmentId';
export const projectIdLabelName: string = 'compartment.projectId';
export const routeHostLabelName: string = 'compartment.routeHost';
export const serviceIdLabelName: string = 'compartment.serviceId';
export const releaseContainerLabelName: string = 'compartment.release';
export const upstreamHostLabelName: string = 'compartment.upstreamHost';
export const upstreamPortLabelName: string = 'compartment.upstreamPort';

export function buildRuntimeContainerLabels(
  context: ResolvedRuntimeDeploymentContext,
  input: NodeDeployRequest,
): Record<string, string> {
  return {
    ...buildDockerNamespaceLabels(context.dockerNamespace),
    [deploymentIdLabelName]: input.deploymentId,
    [environmentIdLabelName]: input.environmentId,
    [projectIdLabelName]: input.projectId,
    [routeHostLabelName]: input.routeHost,
    [serviceIdLabelName]: input.serviceId,
    [upstreamHostLabelName]: context.upstreamHost,
    [upstreamPortLabelName]: context.upstreamPort.toString(),
    'compartment.environment': input.environmentName,
    'compartment.project': input.projectName,
    'compartment.service': input.serviceName,
  };
}

export function buildReleaseContainerLabels(
  dockerNamespace: string,
  input: NodeReleaseRequest,
): Record<string, string> {
  return {
    ...buildDockerNamespaceLabels(dockerNamespace),
    [deploymentIdLabelName]: input.deploymentId,
    [environmentIdLabelName]: input.environmentId,
    [projectIdLabelName]: input.projectId,
    [serviceIdLabelName]: input.serviceId,
    'compartment.environment': input.environmentName,
    'compartment.project': input.projectName,
    [releaseContainerLabelName]: 'true',
    'compartment.service': input.serviceName,
  };
}
