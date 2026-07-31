export interface QueuedDeploymentClaimCandidateRow {
  createdAt: string;
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
}

export interface BuildQueueCountsRow {
  activeBuildCount: number;
  queueDepth: number;
}

export interface UpdatedDeploymentIdRow {
  id: string;
}
