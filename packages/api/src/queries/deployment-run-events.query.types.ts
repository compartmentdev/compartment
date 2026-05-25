import type {
  DeploymentRunLogLevel,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
  DeploymentLogStream,
} from '@compartment/contracts';
import type { Database } from '../db/client';
import type { deploymentRunEvents } from '../db/schema';

export type PersistedDeploymentRunEventRow = typeof deploymentRunEvents.$inferSelect;

export interface DeploymentRunEventRow {
  createdAt: Date;
  deploymentId: string | null;
  deploymentRunId: string;
  id: string;
  level: DeploymentRunLogLevel;
  message: string;
  status: DeploymentRunStepStatus | null;
  stepKey: DeploymentRunStepKey;
  stream: DeploymentLogStream;
}

export interface AppendDeploymentRunEventInput {
  createdAt: Date;
  deploymentId?: string | null | undefined;
  deploymentRunId: string;
  id: string;
  level: DeploymentRunLogLevel;
  message: string;
  status?: DeploymentRunStepStatus | null | undefined;
  stepKey: DeploymentRunStepKey;
  stream: DeploymentLogStream;
}

export type DeploymentRunEventExecutor = Pick<Database, 'insert' | 'select'>;
