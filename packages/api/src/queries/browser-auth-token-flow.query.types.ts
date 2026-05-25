export type BrowserAuthTokenFlowKind = 'activation' | 'password_reset';

export interface BrowserAuthTokenFlowRow {
  consumedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  kind: BrowserAuthTokenFlowKind;
  tokenCiphertext: string;
}

export interface PersistedBrowserAuthTokenFlowRow extends Omit<BrowserAuthTokenFlowRow, 'kind'> {
  kind: string;
}

export interface CreateBrowserAuthTokenFlowInput {
  expiresAt: Date;
  id: string;
  kind: BrowserAuthTokenFlowKind;
  tokenCiphertext: string;
}

export interface DeleteStaleBrowserAuthTokenFlowsBatchInput {
  limit: number;
  now: Date;
}
