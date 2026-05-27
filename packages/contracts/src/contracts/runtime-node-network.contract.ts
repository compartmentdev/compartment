import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface NodeRuntimeNetworkReconcileResponse {
  success: true;
}

export const nodeRuntimeNetworkReconcilePathname: string = '/internal/runtime-networks/reconcile';

export const nodeRuntimeNetworkReconcileResponseSchema: ContractSchema<NodeRuntimeNetworkReconcileResponse> = z
  .object({
    success: z.literal(true),
  })
  .strict();
