import type { ResourceRuntimeStatus } from '@compartment/contracts';
import type { ApiDatabaseTransaction } from '../db/client.types';

export type ProjectResourceRowStatus = ResourceRuntimeStatus;

export interface ProjectResourceRow {
  commandJson: string;
  containerId: string | null;
  createdAt: Date;
  envJson: string;
  environmentId: string;
  hostname: string;
  id: string;
  image: string;
  name: string;
  operationConfigHash: string;
  operationsJson: string;
  outputsJson?: string | undefined;
  portsJson: string;
  readinessJson: string;
  restartPolicy: string;
  runtimeDefinitionHash: string;
  status: ProjectResourceRowStatus;
  updatedAt: Date;
  volumesJson: string;
}

export type PersistedProjectResourceRow = Omit<ProjectResourceRow, 'createdAt' | 'updatedAt'> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

export interface CreateProjectResourceInput {
  commandJson: string;
  envJson: string;
  environmentId: string;
  hostname: string;
  id: string;
  image: string;
  name: string;
  operationConfigHash: string;
  operationsJson: string;
  outputsJson: string;
  portsJson: string;
  readinessJson: string;
  restartPolicy: string;
  runtimeDefinitionHash: string;
  status: ResourceRuntimeStatus;
  updatedAt: Date;
  volumesJson: string;
}

export interface UpdateProjectResourceIntentInput {
  commandJson: string;
  envJson: string;
  hostname: string;
  image: string;
  operationConfigHash: string;
  operationsJson: string;
  outputsJson: string;
  portsJson: string;
  projectResourceId: string;
  readinessJson: string;
  restartPolicy: string;
  runtimeDefinitionHash: string;
  updatedAt: Date;
  volumesJson: string;
}

export interface UpdateProjectResourceRuntimeInput {
  containerId: string | null;
  projectResourceId: string;
  status: ResourceRuntimeStatus;
  updatedAt: Date;
}

export type ResourceTransaction = ApiDatabaseTransaction;
