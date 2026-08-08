import type { ClaimedDeploymentContext } from './deployments.service.types';

export interface BuildQueueClaimInput {
  maximumConcurrentBuilds: number;
  maximumConcurrentBuildsPerOrganization: number;
}

export interface BuildQueueObservation {
  activeBuildCount: number;
  queueDepth: number;
  waitTimeMs: number | null;
}

export interface ClaimedDeploymentBuildQueueResult {
  deployment: ClaimedDeploymentContext | null;
  queue: BuildQueueObservation;
}

export interface ClaimedDeploymentReservation {
  createdAt: string;
  deploymentId: string;
  queue: BuildQueueObservation;
}
