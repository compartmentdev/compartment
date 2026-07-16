export interface StoredOperationRow {
  actorPrincipalId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  id: string;
  status: string;
  summary: string;
  targetId: string;
  targetType: string;
  type: string;
}

export interface StoredDeploymentRow {
  completedAt: Date | null;
  createdAt: Date;
  buildArtifactId: string;
  environmentId: string;
  failureMessage: string | null;
  health: string;
  id: string;
  isActive: boolean;
  movementSourceDeploymentId: string | null;
  operationId: string;
  promotionStage: string;
  projectServiceId: string;
  resolvedRunJson: string;
  resolvedRoutesJson: string;
  status: string;
  updatedAt: Date;
}

export interface StoredBuildArtifactRow {
  createdAt: Date;
  id: string;
  imageRepository: string;
  imageRef: string | null;
  projectId: string;
  projectServiceId: string;
  resolvedBuildJson: string;
  resolvedBuildEnvJson: string;
  sourceDigest: string;
  updatedAt: Date;
}
