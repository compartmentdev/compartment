import type { ApiDatabaseTransaction } from '../db/client.types';
import type { DeploymentKubeState } from './deployment-kube-state.types';

export interface UpsertDeploymentKubeReferenceInput {
  deploymentId: string;
  deploymentName: string;
  id: string;
  namespace: string;
  networkPolicyNames: string[];
  serviceName: string;
}

export interface PersistDeploymentKubeTransitionInput {
  audit: DeploymentKubeDriftAuditInput | null;
  deploymentId: string;
  environmentId: string;
  eventAt: Date;
  expectedRevision: number;
  nextState: DeploymentKubeState;
  observedAt: Date | null;
  organizationId: string;
  projectId: string;
  projectServiceId: string;
}

export interface DeploymentKubeDriftAuditInput {
  kind: 'deleted' | 'drifted' | 'non-ready';
  message: string;
}

export type DeploymentKubeTransitionTransaction = ApiDatabaseTransaction;
