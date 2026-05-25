import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface WorkerArtifactCleanupTarget {
  imageRef: string;
}

export interface WorkerCompleteDeploymentResponse {
  cleanupArtifacts: WorkerArtifactCleanupTarget[];
}

export const workerArtifactCleanupTargetSchema: ContractSchema<WorkerArtifactCleanupTarget> = z
  .object({
    imageRef: z.string().min(1),
  })
  .strict();

export const workerCompleteDeploymentResponseSchema: ContractSchema<WorkerCompleteDeploymentResponse> = z
  .object({
    cleanupArtifacts: z.array(workerArtifactCleanupTargetSchema),
  })
  .strict();
