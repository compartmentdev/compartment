import type { Database } from '../db/client';
import type { AuthSessionMethodKind } from './authentication.query.types';

export interface CliLoginAttemptRow {
  authenticatedAt: Date | null;
  authenticatedAuthMethodKind: AuthSessionMethodKind | null;
  authenticatedOidcProviderId: string | null;
  authenticatedPrincipalId: string | null;
  browserCodeHash: string;
  createdAt: Date;
  exchangeSecretHash: string;
  exchangedAt: Date | null;
  expectedPrincipalEmail: string | null;
  expiresAt: Date;
  id: string;
  onboardingSessionId: string | null;
  organizationId: string | null;
}

export interface CreateCliLoginAttemptInput {
  browserCodeHash: string;
  exchangeSecretHash: string;
  expectedPrincipalEmail: string | null;
  expiresAt: Date;
  id: string;
  onboardingSessionId?: string | null | undefined;
  organizationId: string | null;
}

export type CliLoginAttemptExecutor = Pick<Database, 'delete' | 'insert' | 'select' | 'update'>;
