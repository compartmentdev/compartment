import type { DeploymentLogLine, ProductLogIngestEvent, ResourceLogLine } from '@compartment/contracts';

export interface DeploymentLogIdentityRow {
  createdAt: Date;
  deploymentId: string;
  deploymentName: string;
  namespace: string;
}

export interface InsertDeploymentProductLogInput extends ProductLogIngestEvent {
  appKey: string;
  deploymentId: string;
  resourceId?: never;
}

export interface InsertResourceProductLogInput extends ProductLogIngestEvent {
  appKey: string;
  deploymentId?: never;
  resourceId: string;
}

export type InsertProductLogInput = InsertDeploymentProductLogInput | InsertResourceProductLogInput;

export interface InsertDeploymentProductLogsResult {
  attempted: number;
  inserted: number;
}

export interface InsertedProductLogAppKey {
  appKey: string;
}

export interface ListDeploymentProductLogsInput {
  deploymentIds: string[];
  limit: number;
  since?: Date | undefined;
}

export type DeploymentProductLogLine = DeploymentLogLine;

export interface ResourceLogIdentityRow {
  namespaceId: string;
  resourceId: string;
}

export interface ListResourceProductLogsInput {
  limit: number;
  resourceId: string;
  since?: Date | undefined;
}

export type ResourceProductLogLine = ResourceLogLine;
