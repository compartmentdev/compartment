import type { DeploymentRunLogLevel, DeploymentRunStepKey, DeploymentRunStepStatus } from '@compartment/contracts';

export type DeploymentKubePhaseState = 'active' | 'desired' | 'pending' | 'stopped' | 'stopping';

export interface DeploymentKubePhaseReference {
  deploymentId: string;
  state: DeploymentKubePhaseState;
}

export interface DeploymentPhaseEventRow {
  createdAt: Date;
  deploymentId: string | null;
  deploymentRunId: string;
  id: string;
  level: DeploymentRunLogLevel;
  message: string;
  status: DeploymentRunStepStatus;
  stepKey: DeploymentRunStepKey;
}

export interface DeploymentPhaseEventDatabaseRow extends Omit<DeploymentPhaseEventRow, 'level' | 'status' | 'stepKey'> {
  level: string;
  status: string | null;
  stepKey: string;
}
