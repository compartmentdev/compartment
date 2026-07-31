import type {
  WorkerBuildArtifactSummary,
  WorkerClaimDeploymentResponse,
  WorkerClaimedDeployment,
  WorkerProjectServiceSummary,
} from '@compartment/contracts';
import type { WorkerClaimedDeploymentInput } from '../../services/presenter.types';
import type { ClaimedDeploymentBuildQueueResult } from '../../services/deployment-worker-claim.service.types';
import { parseSerializedCompartmentRoutes } from '../../services/compartment-routes.service';
import { parseResolvedBuild } from '../../services/deployment-build.service';

export function buildWorkerClaimDeploymentResponse(
  claimed: ClaimedDeploymentBuildQueueResult,
): WorkerClaimDeploymentResponse {
  return {
    deployment: claimed.deployment === null ? null : buildWorkerClaimedDeployment(claimed.deployment),
    queue: claimed.queue,
  };
}

function buildWorkerClaimedDeployment(claimed: WorkerClaimedDeploymentInput): WorkerClaimedDeployment {
  return {
    artifact: buildWorkerArtifactSummary(claimed),
    buildEnv: claimed.buildEnv,
    deploymentId: claimed.deployment.deployment.id,
    deploymentRunId: claimed.deployment.deployment.deploymentRunId,
    environmentId: claimed.deployment.environment.id,
    environmentName: claimed.deployment.environment.name,
    projectId: claimed.deployment.project.id,
    projectName: claimed.deployment.project.name,
    requiresSourceRoutesFile:
      parseSerializedCompartmentRoutes(claimed.deployment.deployment.resolvedRoutesJson).length > 0,
    routeHost: claimed.routeHost,
    run: claimed.run,
    service: buildWorkerServiceSummary(claimed),
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
