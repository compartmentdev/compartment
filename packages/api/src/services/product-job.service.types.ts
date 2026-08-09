import type {
  ProductJobIntent,
  ProductJobResourceReadiness,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';

export interface ClaimedProductJobResult {
  intent: ProductJobIntent | null;
  persistedResult: WorkerPersistProductJobResultRequest | null;
  resourceReadiness: ProductJobResourceReadiness[];
}
