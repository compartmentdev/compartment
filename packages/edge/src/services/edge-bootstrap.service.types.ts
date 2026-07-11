import type { AppAccessStateSnapshot } from '@compartment/contracts';

export interface EdgeBootstrapFetchError extends Error {
  cause?: {
    code?: string | undefined;
  };
}

// SPIKE-T7: disk envelope is intentionally separate from the public snapshot contract.
export interface PersistedEdgeAccessStateSnapshot {
  persistedAt: string;
  state: AppAccessStateSnapshot;
}

export interface PersistedEdgeAccessStateEnvelope {
  persistedAt: string;
  state: object;
}
