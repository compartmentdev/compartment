import type {
  NodeDeployRequest,
  NodeDeployResponse,
  NodePreviousDeployment,
  NodeReleaseRequest,
  ResolvedOptionalServiceReadinessConfig,
  WorkerClaimedDeployment,
} from '@compartment/contracts';
import type { ActiveRuntimeStateUpdate } from './worker-runtime-deploy.types';

export function buildNodeDeployRequest(deployment: WorkerClaimedDeployment, imageRef: string): NodeDeployRequest {
  const previousDeployment: NodePreviousDeployment | undefined = buildNodePreviousDeployment(deployment);

  return {
    deploymentId: deployment.deploymentId,
    environmentId: deployment.environmentId,
    environmentName: deployment.environmentName,
    imageRef,
    ...(previousDeployment !== undefined ? { previousDeployment } : {}),
    projectId: deployment.projectId,
    projectName: deployment.projectName,
    readiness: deployment.readiness,
    routeHost: deployment.routeHost,
    run: deployment.run,
    runtimeNetwork: deployment.runtimeNetwork,
    runtimeEnv: deployment.runtimeEnv,
    serviceId: deployment.service.id,
    serviceName: deployment.service.name,
  };
}

function buildNodePreviousDeployment(deployment: WorkerClaimedDeployment): NodePreviousDeployment | undefined {
  if (deployment.previousDeployment === undefined) {
    return undefined;
  }

  return {
    upstreamPort: deployment.previousDeployment.upstreamPort,
  };
}

export function buildNodeReleaseRequest(deployment: WorkerClaimedDeployment, imageRef: string): NodeReleaseRequest {
  if (deployment.release === null) {
    throw new Error(`Deployment ${deployment.deploymentId} does not define a release command.`);
  }

  return {
    deploymentId: deployment.deploymentId,
    environmentId: deployment.environmentId,
    environmentName: deployment.environmentName,
    imageRef,
    projectId: deployment.projectId,
    projectName: deployment.projectName,
    release: deployment.release,
    runtimeNetwork: deployment.runtimeNetwork,
    runtimeEnv: deployment.runtimeEnv,
    serviceId: deployment.service.id,
    serviceName: deployment.service.name,
  };
}

export function buildRuntimeReadyEventMessage(readiness: ResolvedOptionalServiceReadinessConfig): string {
  return readiness === null ? 'runtime started without readiness check' : 'readiness passed';
}

export function buildActiveRuntimeStateUpdate(
  deploymentId: string,
  nodeResponse: NodeDeployResponse,
): ActiveRuntimeStateUpdate {
  return {
    containerId: nodeResponse.containerId,
    deploymentId,
    drain: null,
    promotionStage: 'active',
    upstreamHost: nodeResponse.upstreamHost,
    upstreamPort: nodeResponse.upstreamPort,
  };
}
