import type { DeploymentLogLine, ProductLogIngestEvent } from '@compartment/contracts';

export interface DeploymentLogIdentityRow {
  createdAt: Date;
  deploymentId: string;
  deploymentName: string;
  namespace: string;
}

export interface InsertDeploymentProductLogInput extends ProductLogIngestEvent {
  deploymentId: string;
}

export interface InsertDeploymentProductLogsResult {
  inserted: number;
  quotaAccepted: number;
}

export interface InsertedProductLogMessage {
  message: string;
}

export interface ProductLogQuotaRow {
  usedBytes: number;
}

export interface ListDeploymentProductLogsInput {
  deploymentIds: string[];
  limit: number;
  since?: Date | undefined;
}

export type DeploymentProductLogLine = DeploymentLogLine;

export interface DeleteExpiredDeploymentProductLogsInput {
  capturedBefore: Date;
  limit: number;
}
