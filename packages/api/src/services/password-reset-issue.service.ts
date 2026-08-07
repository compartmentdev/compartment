import argon2 from 'argon2';
import {
  createPasswordResetNotAvailableError,
  createUserNotManageableError,
  createPasswordResetUserNotFoundError,
} from '../errors/api-business-error';
import {
  findOrganizationUserByEmailWithExecutor,
  lockPrincipalRowWithExecutor,
} from '../queries/organization-users.query';
import { hasLocalPasswordEnabledOrganizationMembershipByIdWithExecutor } from '../queries/organization-memberships.query';
import type {
  OrganizationUserRow,
  OrganizationUsersTransaction,
  PrincipalCredentialRow,
} from '../queries/organization-users.query.types';
import { listOrganizationRowsForPrincipalWithExecutor } from '../queries/organizations.query';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { insertOperationRecordWithExecutor } from '../queries/operations.query';
import { setPasswordResetTokenWithExecutor } from '../queries/password-reset.query';
import {
  findPrincipalCredentialByEmailWithExecutor,
  lockPrincipalByEmailWithExecutor,
} from '../queries/principal-credentials.query';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import { buildOrganizationUserAuditMetadata } from './audit-event-metadata.service';
import { recordAuditEvent, writeCommittedAuditEventsToLocalFileSink } from './audit-events.service';
import type { AuditEventActorInput, AuditEventResult } from './audit-events.service.types';
import { buildPasswordResetUrl, createIssuePasswordResetPlan } from './password-reset.service.helpers';
import type {
  RejectOrganizationUserPasswordResetInput,
  IssuePasswordResetInput,
  IssuePasswordResetPlan,
  IssuePasswordResetResult,
} from './password-reset-issue.service.types';

interface PersistPasswordResetIssueInput {
  email: string;
  organizationId: string;
  plan: IssuePasswordResetPlan;
  principalId: string;
  summary: string;
}

interface IssueSystemPasswordResetTransactionResult extends IssuePasswordResetResult {
  auditEvents: AuditEventResult[];
}

export async function issuePasswordReset(input: IssuePasswordResetInput): Promise<IssuePasswordResetResult> {
  const plan: IssuePasswordResetPlan = createIssuePasswordResetPlan({
    config: getApiConfig(),
    email: input.email,
  });

  const result: IssueSystemPasswordResetTransactionResult = await getApiDatabase().transaction(
    async (tx: OrganizationUsersTransaction): Promise<IssueSystemPasswordResetTransactionResult> =>
      await issueSystemPasswordResetWithExecutor(tx, plan),
  );
  writeCommittedAuditEventsToLocalFileSink(result.auditEvents);

  return {
    email: result.email,
    expiresAt: result.expiresAt,
    resetToken: result.resetToken,
    resetUrl: result.resetUrl,
  };
}

export async function rejectOrganizationUserPasswordReset(
  input: RejectOrganizationUserPasswordResetInput,
): Promise<never> {
  return await getApiDatabase().transaction(
    async (tx: OrganizationUsersTransaction): Promise<never> =>
      await rejectOrganizationPasswordResetWithExecutor(tx, input),
  );
}

async function issueSystemPasswordResetWithExecutor(
  tx: OrganizationUsersTransaction,
  plan: IssuePasswordResetPlan,
): Promise<IssueSystemPasswordResetTransactionResult> {
  const principal: PrincipalCredentialRow = await requireSystemPasswordResetPrincipalForEmail(tx, plan.email);
  const organization: OrganizationRow = await requireSystemPasswordResetOrganizationForPrincipal(tx, principal);

  await persistPasswordResetIssue(tx, {
    email: principal.email,
    organizationId: organization.id,
    plan,
    principalId: principal.principalId,
    summary: `Issued password reset for ${principal.email}`,
  });

  return {
    auditEvents: await recordPasswordResetIssueAuditEvents(tx, principal, [organization]),
    email: principal.email,
    expiresAt: plan.expiresAt,
    resetToken: plan.resetToken,
    resetUrl: buildPasswordResetUrl(principal.email, plan.resetToken, plan.config),
  };
}

async function requireSystemPasswordResetPrincipalForEmail(
  tx: OrganizationUsersTransaction,
  email: string,
): Promise<PrincipalCredentialRow> {
  await lockPrincipalByEmailWithExecutor(tx, email);

  return requireSystemPasswordResetPrincipal(await findPrincipalCredentialByEmailWithExecutor(tx, email));
}

async function requireSystemPasswordResetOrganizationForPrincipal(
  tx: OrganizationUsersTransaction,
  principal: PrincipalCredentialRow,
): Promise<OrganizationRow> {
  return await requireSystemPasswordResetOrganization(
    tx,
    principal.principalId,
    await listOrganizationRowsForPrincipalWithExecutor(tx, principal.principalId),
  );
}

async function rejectOrganizationPasswordResetWithExecutor(
  tx: OrganizationUsersTransaction,
  input: RejectOrganizationUserPasswordResetInput,
): Promise<never> {
  await requireOrganizationPasswordResetUser(tx, input.organizationId, input.email);

  throw createPasswordResetNotAvailableError();
}

async function requireOrganizationPasswordResetUser(
  tx: OrganizationUsersTransaction,
  organizationId: string,
  email: string,
): Promise<OrganizationUserRow> {
  const user: OrganizationUserRow | undefined = await findOrganizationUserByEmailWithExecutor(
    tx,
    organizationId,
    email,
  );
  if (user === undefined) {
    throw createPasswordResetUserNotFoundError();
  }

  await lockPrincipalRowWithExecutor(tx, user.id);
  return requirePasswordResetOrganizationUser(user);
}

function requireSystemPasswordResetPrincipal(principal: PrincipalCredentialRow | undefined): PrincipalCredentialRow {
  if (principal === undefined) {
    throw createPasswordResetUserNotFoundError();
  }
  if (
    principal.principalType !== 'user' ||
    principal.credentialPrincipalId === null ||
    principal.passwordHash === null
  ) {
    throw createPasswordResetNotAvailableError();
  }

  return principal;
}

function requirePasswordResetOrganizationUser(user: OrganizationUserRow): OrganizationUserRow {
  if (user.type !== 'user') {
    throw createUserNotManageableError();
  }
  if (user.passwordHash === null) {
    throw createPasswordResetNotAvailableError();
  }

  return user;
}

async function requireSystemPasswordResetOrganization(
  tx: OrganizationUsersTransaction,
  principalId: string,
  organizations: readonly OrganizationRow[],
): Promise<OrganizationRow> {
  const organization: OrganizationRow | undefined = organizations[0];
  if (organization === undefined || organizations.length !== 1) {
    throw createPasswordResetNotAvailableError();
  }
  if (!(await hasLocalPasswordEnabledOrganizationMembershipByIdWithExecutor(tx, principalId, organization.id))) {
    throw createPasswordResetNotAvailableError();
  }

  return organization;
}

async function persistPasswordResetIssue(
  tx: OrganizationUsersTransaction,
  input: PersistPasswordResetIssueInput,
): Promise<void> {
  await setPasswordResetTokenWithExecutor(tx, {
    passwordResetTokenExpiresAt: input.plan.expiresAt,
    passwordResetTokenHash: await argon2.hash(input.plan.resetToken),
    passwordResetOrganizationId: input.organizationId,
    principalId: input.principalId,
    updatedAt: input.plan.now,
  });
  await insertOperationRecordWithExecutor(tx, {
    completedAt: input.plan.now,
    organizationId: input.organizationId,
    status: 'succeeded',
    summary: input.summary,
    targetId: input.principalId,
    targetType: 'principal',
    type: 'auth.password_reset.issue',
  });
}

async function recordPasswordResetIssueAuditEvents(
  tx: OrganizationUsersTransaction,
  principal: PrincipalCredentialRow,
  organizations: readonly OrganizationRow[],
): Promise<AuditEventResult[]> {
  const auditEvents: AuditEventResult[] = [];
  for (const organization of organizations) {
    auditEvents.push(await recordPasswordResetIssueAuditEvent(tx, principal, organization));
  }

  return auditEvents;
}

async function recordPasswordResetIssueAuditEvent(
  tx: OrganizationUsersTransaction,
  principal: PrincipalCredentialRow,
  organization: OrganizationRow,
): Promise<AuditEventResult> {
  return await recordAuditEvent({
    actor: createSystemAuditActor(),
    eventType: 'organization.user.password_reset_issued',
    executor: tx,
    metadata: buildOrganizationUserAuditMetadata({ email: principal.email }),
    organizationId: organization.id,
    target: {
      displayName: principal.email,
      id: principal.principalId,
      type: 'user',
    },
  });
}

function createSystemAuditActor(): AuditEventActorInput {
  return {
    email: null,
    principalId: null,
    sessionId: null,
    sourceIp: null,
    transport: 'system',
    type: 'system',
    userAgent: null,
  };
}
