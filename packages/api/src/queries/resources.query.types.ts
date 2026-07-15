import type { ResourceRuntimeStatus } from '@compartment/contracts';
import type { ApiDatabaseTransaction } from '../db/client.types';

export type ProjectResourceRowStatus = ResourceRuntimeStatus;

export interface ProjectResourceRow {
  commandJson: string;
  createdAt: Date;
  envJson: string;
  environmentId: string;
  expectedClaimsJson: string;
  id: string;
  image: string;
  name: string;
  operationConfigHash: string;
  operationsJson: string;
  outputsJson?: string | undefined;
  portsJson: string;
  readinessJson: string;
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
  expectedClaimsJson?: string | undefined;
  id: string;
  image: string;
  name: string;
  operationConfigHash: string;
  operationsJson: string;
  outputsJson: string;
  portsJson: string;
  readinessJson: string;
  runtimeDefinitionHash: string;
  status: ResourceRuntimeStatus;
  updatedAt: Date;
  volumesJson: string;
}

export interface UpdateProjectResourceIntentInput {
  commandJson: string;
  envJson: string;
  image: string;
  operationConfigHash: string;
  operationsJson: string;
  outputsJson: string;
  portsJson: string;
  projectResourceId: string;
  readinessJson: string;
  runtimeDefinitionHash: string;
  updatedAt: Date;
  volumesJson: string;
}

export interface UpdateProjectResourceStatusInput {
  projectResourceId: string;
  status: ResourceRuntimeStatus;
  updatedAt: Date;
}

export type ResourceTransaction = ApiDatabaseTransaction;
