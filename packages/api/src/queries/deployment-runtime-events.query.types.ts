import type { DeploymentLogStream } from '@compartment/contracts';
import type { deploymentRunEvents } from '../db/schema';

export type PersistedDeploymentRuntimeEventRow = typeof deploymentRunEvents.$inferSelect;

export interface DeploymentRuntimeEventRow {
  createdAt: Date;
  deploymentId: string;
  id: string;
  message: string;
  stream: DeploymentLogStream;
}
