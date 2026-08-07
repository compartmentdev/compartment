export interface DeploymentLogIdentity {
  appKey: string;
  deploymentId: string;
}

export interface ProductLogIngestResult {
  accepted: number;
  duplicates: number;
  rejected: number;
}
