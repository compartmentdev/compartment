import type { OrganizationUserType } from '@compartment/contracts';
import type { ApiDatabaseTransaction } from '../db/client.types';

export type OrganizationPrincipalType = OrganizationUserType;

export interface OrganizationUserRow {
  blockedAt: Date | null;
  bootstrapTokenExpiresAt: Date | null;
  email: string;
  groupCount: number;
  hasSsoOidcIdentity: boolean;
  id: string;
  passwordHash: string | null;
  roleNames: string[];
  type: OrganizationUserType;
}

export interface OrganizationUserQueryRow {
  blockedAt: Date | null;
  bootstrapTokenExpiresAt: Date | null;
  email: string;
  hasSsoOidcIdentity: boolean;
  id: string;
  passwordHash: string | null;
  type: string;
}

export interface PrincipalCredentialRow {
  bootstrapTokenExpiresAt: Date | null;
  bootstrapTokenHash: string | null;
  credentialPrincipalId: string | null;
  email: string;
  passwordHash: string | null;
  passwordResetOrganizationId: string | null;
  passwordResetTokenExpiresAt: Date | null;
  passwordResetTokenHash: string | null;
  principalId: string;
  principalType: string;
}

export interface OrganizationPrincipalAccessRow {
  blockedAt: Date | null;
  hasSsoOidcIdentity: boolean;
  passwordHash: string | null;
  principalId: string;
  principalType: string;
}

export interface OrganizationMembershipAccessRow {
  blockedAt: Date | null;
  principalId: string;
}

export interface CreatePrincipalInput {
  email: string;
  principalId: string;
}

export interface SetBootstrapTokenInput {
  bootstrapTokenExpiresAt: Date;
  bootstrapTokenHash: string;
  principalId: string;
  updatedAt: Date;
}

export interface UpdateOrganizationMembershipBlockInput {
  blockedAt: Date | null;
  organizationId: string;
  principalId: string;
}

export interface RemoveOrganizationMembershipInput {
  organizationId: string;
  principalId: string;
}

export interface FinalizeLocalActivationInput {
  bootstrapTokenHash: string;
  organizationId: string;
  passwordHash: string;
  principalId: string;
  updatedAt: Date;
}

export type OrganizationUsersTransaction = ApiDatabaseTransaction;
