import type {
  CreateQueuedExistingArtifactDeploymentBatchItem,
  DeploymentRow,
} from '../queries/deployments.query.types';
import type { DeploymentMovementOperationType } from './deployment-movement.service.types';

export interface SerializedDeploymentMovementBatchItem {
  item: CreateQueuedExistingArtifactDeploymentBatchItem;
  operationType: DeploymentMovementOperationType;
  requestIndex: number;
  sourceDeploymentId: string;
}

export interface ResolvedDeploymentMovementBatchItem {
  deployment: DeploymentRow;
  requestIndex: number;
}

export type TargetMovementClassification =
  | { kind: 'conflict' }
  | { deployment: DeploymentRow; inFlight: boolean; kind: 'duplicate' }
  | { kind: 'free' };
