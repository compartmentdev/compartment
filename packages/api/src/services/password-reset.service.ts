import argon2 from 'argon2';
import type { ApiConfig } from '../config';
import { createInvalidPasswordResetTokenError } from '../errors/api-business-error';
import type { OrganizationUsersTransaction, PrincipalCredentialRow } from '../queries/organization-users.query.types';
import { insertOperationRecordWithExecutor } from '../queries/operations.query';
import { hasLocalPasswordEnabledOrganizationMembershipByIdWithExecutor } from '../queries/organization-memberships.query';
import { findOrganizationRowForPrincipalByIdWithExecutor } from '../queries/organizations.query';
import type { OrganizationRow } from '../queries/organizations.query.types';
import {
  completePasswordResetWithExecutor,
  lockPasswordResetCredentialRowWithExecutor,
} from '../queries/password-reset.query';
import {
  findPrincipalCredentialByEmailWithExecutor,
  lockPrincipalByEmailWithExecutor,
} from '../queries/principal-credentials.query';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import { revokePrincipalAuthSessionsWithExecutor } from './auth-session-revocation.service';
import {
  buildAuthSessionOrganizationPolicySession,
  createScopedPasswordAuthSessionInput,
  issueAuthSessionWithExecutor,
} from './auth-session.service';
import type { AuthSessionPlan } from './auth-session.types';
import { invalidateRevokedEdgeSessions } from './password-reset-edge-session.service';
import { createResetPlan } from './password-reset.service.helpers';
import type {
  PasswordResetPlan,
  PasswordResetScopeValidationResult,
  PasswordResetTransactionResult,
  PasswordResetValidationResult,
  ResetPasswordResult,
} from './password-reset.service.types';
import { readStoredResetOrganizationId, readStoredResetTokenHash } from './password-reset-token.service.helpers';
import type { ScopedTokenScope } from './scoped-token.service.types';
import { readScopedTokenScope } from './scoped-token.service.helpers';

export async function resetPassword(
  email: string,
  newPassword: string,
  resetToken: string,
): Promise<ResetPasswordResult> {
  const config: ApiConfig = getApiConfig();
  const plan: PasswordResetPlan = createResetPlan(email, newPassword, resetToken, config);
  const result: PasswordResetTransactionResult = await getApiDatabase().transaction(
    async (tx: OrganizationUsersTransaction): Promise<PasswordResetTransactionResult> =>
      await resetPasswordWithExecutor(tx, plan),
  );

  await invalidateRevokedEdgeSessions(result.revokedSessionIds);
  return createResetPasswordResult(result);
}

async function resetPasswordWithExecutor(
  tx: OrganizationUsersTransaction,
  plan: PasswordResetPlan,
): Promise<PasswordResetTransactionResult> {
  const validation: PasswordResetValidationResult = await getValidPasswordResetPrincipal(tx, plan);
  const now: Date = new Date();

  await applyPasswordReset(tx, validation, plan, now);
  return await finalizePasswordReset(tx, validation, plan, now);
}

async function finalizePasswordReset(
  tx: OrganizationUsersTransaction,
  validation: PasswordResetValidationResult,
  plan: PasswordResetPlan,
  now: Date,
): Promise<PasswordResetTransactionResult> {
  const principal: PrincipalCredentialRow = validation.principal;
  const revokedSessionIds: string[] = await revokePrincipalAuthSessionsWithExecutor(tx, principal.principalId, now);
  const session: AuthSessionPlan = await issuePasswordResetSession(tx, validation, plan.config);

  await recordPasswordResetCompletion(tx, principal, now);
  return {
    organizations: validation.organizations,
    principalEmail: principal.email,
    principalId: principal.principalId,
    revokedSessionIds,
    session,
  };
}

async function issuePasswordResetSession(
  tx: OrganizationUsersTransaction,
  validation: PasswordResetValidationResult,
  config: ApiConfig,
): Promise<AuthSessionPlan> {
  return await issueAuthSessionWithExecutor(
    tx,
    createScopedPasswordAuthSessionInput(validation.principal.principalId, validation.sessionOrganizationId),
    config,
  );
}

async function getValidPasswordResetPrincipal(
  tx: OrganizationUsersTransaction,
  plan: PasswordResetPlan,
): Promise<PasswordResetValidationResult> {
  await lockPrincipalByEmailWithExecutor(tx, plan.email);
  const principal: PrincipalCredentialRow = requirePasswordResetCompletionPrincipal(
    await findPrincipalCredentialByEmailWithExecutor(tx, plan.email),
  );

  await assertValidResetToken(principal, plan.resetToken);
  const tokenScope: PasswordResetScopeValidationResult = await assertValidResetTokenScope(
    tx,
    principal,
    plan.resetToken,
  );
  return {
    organizations: tokenScope.organizations,
    principal,
    sessionOrganizationId: tokenScope.sessionOrganizationId,
  };
}

async function applyPasswordReset(
  tx: OrganizationUsersTransaction,
  validation: PasswordResetValidationResult,
  plan: PasswordResetPlan,
  now: Date,
): Promise<void> {
  await lockPasswordResetCredentialRowWithExecutor(tx, validation.principal.principalId);
  const completed: boolean = await completePasswordResetWithExecutor(tx, {
    passwordHash: await argon2.hash(plan.newPassword),
    passwordResetOrganizationId: validation.sessionOrganizationId,
    passwordResetTokenHash: readStoredResetTokenHash(validation.principal),
    principalId: validation.principal.principalId,
    updatedAt: now,
  });
  if (!completed) {
    throw createInvalidPasswordResetTokenError();
  }
}

async function recordPasswordResetCompletion(
  tx: OrganizationUsersTransaction,
  principal: PrincipalCredentialRow,
  now: Date,
): Promise<void> {
  await insertOperationRecordWithExecutor(tx, {
    actorPrincipalId: principal.principalId,
    completedAt: now,
    status: 'succeeded',
    summary: `Reset password for ${principal.email}`,
    targetId: principal.principalId,
    targetType: 'principal',
    type: 'auth.password_reset.complete',
  });
}

function createResetPasswordResult(result: PasswordResetTransactionResult): ResetPasswordResult {
  return {
    authSession: buildAuthSessionOrganizationPolicySession(result.session, result.principalId),
    organizations: result.organizations,
    principalEmail: result.principalEmail,
    principalId: result.principalId,
    sessionExpiresAt: result.session.expiresAt,
    sessionId: result.session.sessionId,
    sessionToken: result.session.sessionToken,
  };
}

function requirePasswordResetCompletionPrincipal(
  principal: PrincipalCredentialRow | undefined,
): PrincipalCredentialRow {
  if (principal === undefined) {
    throw createInvalidPasswordResetTokenError();
  }
  if (
    principal.principalType !== 'user' ||
    principal.credentialPrincipalId === null ||
    principal.passwordHash === null
  ) {
    throw createInvalidPasswordResetTokenError();
  }

  return principal;
}

async function assertValidResetToken(principal: PrincipalCredentialRow, resetToken: string): Promise<void> {
  if (principal.passwordResetTokenExpiresAt === null || principal.passwordResetTokenExpiresAt <= new Date()) {
    throw createInvalidPasswordResetTokenError();
  }
  if (!(await argon2.verify(readStoredResetTokenHash(principal), resetToken))) {
    throw createInvalidPasswordResetTokenError();
  }
}

async function assertValidResetTokenScope(
  tx: OrganizationUsersTransaction,
  principal: PrincipalCredentialRow,
  resetToken: string,
): Promise<PasswordResetScopeValidationResult> {
  assertSystemResetToken(resetToken);
  const organization: OrganizationRow = await requireStoredPasswordResetOrganization(tx, principal);

  return {
    organizations: [organization],
    sessionOrganizationId: organization.id,
  };
}

function assertSystemResetToken(resetToken: string): void {
  const tokenScope: ScopedTokenScope = readScopedTokenScope(resetToken);
  if (tokenScope.kind !== 'system') {
    throw createInvalidPasswordResetTokenError();
  }
}

async function requireStoredPasswordResetOrganization(
  tx: OrganizationUsersTransaction,
  principal: PrincipalCredentialRow,
): Promise<OrganizationRow> {
  const organization: OrganizationRow | undefined = await findOrganizationRowForPrincipalByIdWithExecutor(
    tx,
    principal.principalId,
    readStoredResetOrganizationId(principal),
  );
  if (organization === undefined) {
    throw createInvalidPasswordResetTokenError();
  }
  await assertPasswordResetLocalPasswordEnabled(tx, principal, organization.id);

  return organization;
}

async function assertPasswordResetLocalPasswordEnabled(
  tx: OrganizationUsersTransaction,
  principal: PrincipalCredentialRow,
  organizationId: string,
): Promise<void> {
  if (
    !(await hasLocalPasswordEnabledOrganizationMembershipByIdWithExecutor(tx, principal.principalId, organizationId))
  ) {
    throw createInvalidPasswordResetTokenError();
  }
}
