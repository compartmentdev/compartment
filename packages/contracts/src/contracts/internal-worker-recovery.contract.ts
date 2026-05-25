import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import {
  type WorkerArtifactCleanupTarget,
  workerArtifactCleanupTargetSchema,
} from './internal-worker-cleanup.contract';

export type WorkerRecoverDeploymentsMode = 'all' | 'pending-drain';

export interface WorkerRecoverDeploymentsQuery {
  mode?: WorkerRecoverDeploymentsMode | undefined;
}

export interface WorkerRecoverDeploymentsResponse {
  cleanupArtifacts: WorkerArtifactCleanupTarget[];
  recoveredDeploymentCount: number;
}

export const workerRecoverDeploymentsPathname: string = '/internal/deployments/recover-running';

export const workerRecoverDeploymentsQuerySchema: ContractSchema<WorkerRecoverDeploymentsQuery> = z
  .object({
    mode: z.enum(['all', 'pending-drain']).optional(),
  })
  .strict();

export const workerRecoverDeploymentsResponseSchema: ContractSchema<WorkerRecoverDeploymentsResponse> = z
  .object({
    cleanupArtifacts: z.array(workerArtifactCleanupTargetSchema),
    recoveredDeploymentCount: z.number().int().nonnegative(),
  })
  .strict();
