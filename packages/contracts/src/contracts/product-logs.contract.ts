import { z } from 'zod';
import type { DeploymentLogStream } from './deployments.contract';
import type { ContractSchema } from './schema.types';

const productLogIngestBatchLimit: number = 200;
const productLogMessageMaxCharacters: number = 4_096;
export const productLogIngestPathname: string = '/internal/kubernetes/logs';

export interface ProductLogIngestEvent {
  containerName: string;
  message: string;
  namespace: string;
  podName: string;
  podUid: string;
  restartIdentity: string;
  sourceFingerprint: string;
  sourceOffset: number;
  stream: DeploymentLogStream;
  timestamp: string;
}

export interface ProductLogIngestResponse {
  accepted: number;
  duplicates: number;
  rejected: number;
}

const productLogIngestEventSchema: ContractSchema<ProductLogIngestEvent> = z
  .object({
    containerName: z.string().min(1).max(63),
    message: z.string().max(productLogMessageMaxCharacters),
    namespace: z.string().min(1).max(63),
    podName: z.string().min(1).max(253),
    podUid: z.string().uuid(),
    restartIdentity: z.string().min(1).max(128),
    sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    sourceOffset: z.number().int().nonnegative().safe(),
    stream: z.enum(['stdout', 'stderr']),
    timestamp: z.string().datetime(),
  })
  .strict();

export const productLogIngestRequestSchema: ContractSchema<ProductLogIngestEvent[]> = z
  .array(productLogIngestEventSchema)
  .min(1)
  .max(productLogIngestBatchLimit);

export const productLogIngestResponseSchema: ContractSchema<ProductLogIngestResponse> = z
  .object({
    accepted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  })
  .strict();
