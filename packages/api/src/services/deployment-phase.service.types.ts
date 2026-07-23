import type {
  DeploymentPromotionStage,
  DeploymentRuntimeStatus,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
} from '@compartment/contracts';
import type { DeploymentKubePhaseState } from '../queries/deployment-phase.query.types';

export interface DeploymentPhaseEvent {
  createdAt: Date;
  message?: string | undefined;
  status: DeploymentRunStepStatus | null;
  stepKey: DeploymentRunStepKey;
}

export interface ObservedDeploymentPhaseInput {
  events: DeploymentPhaseEvent[];
  kubeState: DeploymentKubePhaseState | null;
  operationType: string;
  status: DeploymentRuntimeStatus;
  storedStage: DeploymentPromotionStage;
}
