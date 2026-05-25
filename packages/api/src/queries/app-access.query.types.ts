import type { Database } from '../db/client';

export interface AppAccessCodeRow {
  authSessionId: string;
  consumedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  host: string;
  id: string;
  redirectPath: string;
  state: string;
  tokenHash: string;
}

export interface ActiveAppAccessSessionRow {
  appSessionId: string;
}

export interface CreateAppAccessCodeInput {
  authSessionId: string;
  expiresAt: Date;
  host: string;
  id: string;
  redirectPath: string;
  state: string;
  tokenHash: string;
}

export interface CreateAppAccessSessionInput {
  authSessionId: string;
  expiresAt: Date;
  host: string;
  id: string;
  tokenHash: string;
}

export interface RevokeBlockedOrganizationUserAppAccessSessionsInput {
  baseDomain: string;
  organizationId: string;
  principalId: string;
  revokedAt: Date;
}

export type AppAccessQueryExecutor = Pick<Database, 'insert' | 'select' | 'update'>;
