import type { DeploymentLogLine, ProductLogIngestEvent, ResourceLogLine } from '@compartment/contracts';

export interface DeploymentLogIdentityRow {
  createdAt: Date;
  deploymentId: string;
  deploymentName: string;
  namespace: string;
}

export interface InsertDeploymentProductLogInput extends ProductLogIngestEvent {
  deploymentId: string;
  resourceId?: never;
}

export interface InsertResourceProductLogInput extends ProductLogIngestEvent {
  deploymentId?: never;
  resourceId: string;
}

export type InsertProductLogInput = InsertDeploymentProductLogInput | InsertResourceProductLogInput;

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

export interface ResourceLogIdentityRow {
  createdAt: Date;
  namespaceId: string;
  resourceId: string;
}

export interface ListResourceProductLogsInput {
  limit: number;
  resourceId: string;
  since?: Date | undefined;
}

export type ResourceProductLogLine = ResourceLogLine;

export interface DeleteExpiredDeploymentProductLogsInput {
  capturedBefore: Date;
  limit: number;
}
