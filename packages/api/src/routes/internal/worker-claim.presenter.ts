import type {
  RuntimePreviousDeployment,
  WorkerBuildArtifactSummary,
  WorkerClaimDeploymentResponse,
  WorkerClaimedDeployment,
  WorkerNodeSummary,
  WorkerProjectServiceSummary,
} from '@compartment/contracts';
import type {
  NodeSummaryInput,
  PreviousDeploymentInput,
  WorkerClaimDeploymentResponseInput,
  WorkerClaimedDeploymentInput,
} from '../../services/presenter.types';
import { parseSerializedCompartmentRoutes } from '../../services/compartment-routes.service';
import { parseResolvedBuild } from '../../services/deployment-build.service';
import { readDeploymentUpstreamHost } from '../../services/deployment-upstream.service';

export function buildWorkerClaimDeploymentResponse(
  claimed: WorkerClaimDeploymentResponseInput,
): WorkerClaimDeploymentResponse {
  return {
    deployment: claimed !== null ? buildWorkerClaimedDeployment(claimed) : null,
  };
}

function buildWorkerClaimedDeployment(claimed: WorkerClaimedDeploymentInput): WorkerClaimedDeployment {
  const previousDeployment: RuntimePreviousDeployment | undefined = buildPreviousDeployment(claimed.previousDeployment);

  return {
    buildEnv: claimed.buildEnv,
    deploymentId: claimed.deployment.deployment.id,
    deploymentRunId: claimed.deployment.deployment.deploymentRunId,
    environmentId: claimed.deployment.environment.id,
    environmentName: claimed.deployment.environment.name,
    node: buildWorkerNodeSummary(claimed.node),
    ...(previousDeployment !== undefined ? { previousDeployment } : {}),
    projectId: claimed.deployment.project.id,
    projectName: claimed.deployment.project.name,
    readiness: claimed.readiness,
    release: claimed.release,
    requiresSourceRoutesFile: readRequiresSourceRoutesFile(claimed),
    run: claimed.run,
    artifact: buildWorkerArtifactSummary(claimed),
    routeHost: claimed.routeHost,
    runtimeEnv: claimed.runtimeEnv,
    service: buildWorkerServiceSummary(claimed),
  };
}

function buildWorkerNodeSummary(node: NodeSummaryInput): WorkerNodeSummary {
  return {
    id: node.id,
    name: node.name,
    nodeSocketPath: node.nodeSocketPath,
  };
}

function buildWorkerArtifactSummary(claimed: WorkerClaimedDeploymentInput): WorkerBuildArtifactSummary {
  return {
    id: claimed.deployment.artifact.id,
    imageRef: claimed.deployment.artifact.imageRef,
    sourceDigest: claimed.deployment.artifact.sourceDigest,
  };
}

function buildWorkerServiceSummary(claimed: WorkerClaimedDeploymentInput): WorkerProjectServiceSummary {
  return {
    build: parseResolvedBuild(claimed.deployment.artifact.resolvedBuildJson),
    id: claimed.deployment.service.id,
    kind: claimed.deployment.service.kind,
    name: claimed.deployment.service.name,
    path: claimed.deployment.service.path,
  };
}

function readRequiresSourceRoutesFile(claimed: WorkerClaimedDeploymentInput): boolean {
  return parseSerializedCompartmentRoutes(claimed.deployment.deployment.resolvedRoutesJson).length > 0;
}

function buildPreviousDeployment(previousDeployment: PreviousDeploymentInput): RuntimePreviousDeployment | undefined {
  if (previousDeployment === null) {
    return undefined;
  }

  return {
    containerId: requireValue(previousDeployment.deployment.deployment.containerId, 'active deployment container id'),
    deploymentId: previousDeployment.deployment.deployment.id,
    imageRef: requireValue(previousDeployment.deployment.artifact.imageRef, 'active deployment image ref'),
    nodeId: previousDeployment.node.id,
    nodeSocketPath: previousDeployment.node.nodeSocketPath,
    upstreamHost: readDeploymentUpstreamHost(previousDeployment.deployment.deployment.upstreamHost),
    upstreamPort: requireValue(
      previousDeployment.deployment.deployment.upstreamPort,
      'active deployment upstream port',
    ),
  };
}

function requireValue<TValue>(value: TValue | null, label: string): TValue {
  if (value === null) {
    throw new Error(`Missing ${label}.`);
  }

  return value;
}
