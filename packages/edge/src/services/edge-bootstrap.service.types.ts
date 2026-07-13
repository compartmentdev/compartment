import type { AppAccessStateSnapshot } from '@compartment/contracts';

export interface EdgeBootstrapFetchError extends Error {
  cause?: {
    code?: string | undefined;
  };
}

export interface PersistedEdgeAccessStateSnapshot {
  persistedAt: string;
  state: AppAccessStateSnapshot;
}

export interface PersistedEdgeAccessStateEnvelope {
  persistedAt: string;
  state: object | null;
}
