import type { ProductJobIntent, WorkerPersistProductJobResultRequest } from '@compartment/contracts';

export interface ClaimedProductJobResult {
  intent: ProductJobIntent | null;
  persistedResult: WorkerPersistProductJobResultRequest | null;
}
