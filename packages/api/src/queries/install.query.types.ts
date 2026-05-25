import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';

export interface InstallInstallationCountRow {
  value: number;
}

export type InstallTransaction = ApiDatabaseTransaction;
export type InstallReadExecutor = Pick<Database, 'select'>;

export type InstallGuardCallback<TResult> = (tx: InstallTransaction) => Promise<TResult>;

export interface CreateInitialInstallationInput {
  adminAssignmentId: string;
  installationMembershipId?: string | undefined;
  membershipId?: string | undefined;
  organizationId: string;
  organizationMembershipId: string;
  organizationName: string;
  organizationSlug: string;
  passwordHash: string;
  principalEmail: string;
  principalId: string;
  sessionExpiresAt: Date;
  sessionId: string;
  sessionTokenHash: string;
}
