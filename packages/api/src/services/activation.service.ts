import type { ActivateUnavailableReason } from '@compartment/contracts';
import argon2 from 'argon2';
import type { ApiConfig } from '../config';
import { createInvalidBootstrapTokenError } from '../errors/api-business-error';
import { hashToken } from '../lib/tokens';
import {
  finalizeLocalActivationWithExecutor,
  findActivatablePrincipalCredentialByEmailWithExecutor,
  findPrincipalCredentialByBootstrapTokenHashWithExecutor,
} from '../queries/activation.query';
import { hasLocalPasswordEnabledOrganizationMembershipByIdWithExecutor } from '../queries/organization-memberships.query';
import type { OrganizationUsersTransaction, PrincipalCredentialRow } from '../queries/organization-users.query.types';
import { insertOperationRecordWithExecutor } from '../queries/operations.query';
import { findOrganizationRowForPrincipalByIdWithExecutor } from '../queries/organizations.query';
import type { OrganizationQueryExecutor, OrganizationRow } from '../queries/organizations.query.types';
import { lockPrincipalByEmailWithExecutor } from '../queries/principal-credentials.query';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import {
  buildAuthSessionOrganizationPolicySession,
  createScopedPasswordAuthSessionInput,
  issueAuthSessionWithExecutor,
} from './auth-session.service';
import type { AuthSessionPlan } from './auth-session.types';
import type { ActivateLocalUserInput, ActivateLocalUserResult } from './activation.service.types';
import {
  doesRequestedEmailMatchPrincipal,
  isBootstrapTokenValid,
  readPendingLocalActivation,
} from './activation-token.service.helpers';
import { readScopedTokenScope } from './scoped-token.service.helpers';
import type { ScopedTokenScope } from './scoped-token.service.types';

interface ActivationAvailabilityContext {
  organizationId: string;
  principalId: string;
}

export async function activateLocalUser(input: ActivateLocalUserInput): Promise<ActivateLocalUserResult> {
  const config: ApiConfig = getApiConfig();

  return await getApiDatabase().transaction(
    async (tx: OrganizationUsersTransaction): Promise<ActivateLocalUserResult> =>
      await activateLocalUserWithExecutor(tx, input, config),
  );
}

export async function readActivationUnavailableReason(
  bootstrapToken: string,
  email: string | undefined,
): Promise<ActivateUnavailableReason | undefined> {
  const tokenHash: string = hashToken(bootstrapToken, getApiConfig().sessionSecret);
  const activation: ActivationAvailabilityContext | undefined = await readActivationAvailabilityContext(
    bootstrapToken,
    tokenHash,
    email,
  );
  if (activation === undefined) {
    return undefined;
  }

  return (await hasLocalPasswordEnabledOrganizationMembershipByIdWithExecutor(
    getApiDatabase(),
    activation.principalId,
    activation.organizationId,
  ))
    ? undefined
    : 'local_password_disabled';
}

async function activateLocalUserWithExecutor(
  tx: OrganizationUsersTransaction,
  input: ActivateLocalUserInput,
  config: ApiConfig,
): Promise<ActivateLocalUserResult> {
  const principal: PrincipalCredentialRow = await getPendingLocalActivation(tx, input.email);
  const tokenHash: string = hashToken(input.bootstrapToken, config.sessionSecret);

  assertValidBootstrapToken(principal, tokenHash);
  const activationOrganization: OrganizationRow = await requireActivationOrganizationForToken(
    tx,
    principal.principalId,
    input.bootstrapToken,
  );
  await assertLocalPasswordActivationAllowed(tx, principal.principalId, activationOrganization.id);
  await finalizePrincipalActivation(tx, principal.principalId, input.password, tokenHash, activationOrganization.id);
  await recordActivationOperation(tx, principal, activationOrganization.id);

  return await buildActivatedLocalUserResult(tx, principal, activationOrganization, config);
}

async function readActivationAvailabilityContext(
  bootstrapToken: string,
  tokenHash: string,
  email: string | undefined,
): Promise<ActivationAvailabilityContext | undefined> {
  const principal: PrincipalCredentialRow | undefined = readPendingLocalActivation(
    await findPrincipalCredentialByBootstrapTokenHashWithExecutor(getApiDatabase(), tokenHash),
  );
  if (principal === undefined || !isBootstrapTokenValid(principal, tokenHash, new Date())) {
    return undefined;
  }
  if (!doesRequestedEmailMatchPrincipal(email, principal.email)) {
    return undefined;
  }
  const activationOrganization: OrganizationRow | undefined = await findActivationOrganizationForToken(
    getApiDatabase(),
    principal.principalId,
    bootstrapToken,
  );

  return activationOrganization === undefined
    ? undefined
    : { organizationId: activationOrganization.id, principalId: principal.principalId };
}

async function buildActivatedLocalUserResult(
  tx: OrganizationUsersTransaction,
  principal: PrincipalCredentialRow,
  organization: OrganizationRow,
  config: ApiConfig,
): Promise<ActivateLocalUserResult> {
  const session: AuthSessionPlan = await issueAuthSessionWithExecutor(
    tx,
    createScopedPasswordAuthSessionInput(principal.principalId, organization.id),
    config,
  );

  return buildActivateLocalUserResult(principal, session, [organization]);
}

async function getPendingLocalActivation(
  tx: OrganizationUsersTransaction,
  email: string,
): Promise<PrincipalCredentialRow> {
  await lockPrincipalByEmailWithExecutor(tx, email);

  return requirePendingLocalActivation(await findActivatablePrincipalCredentialByEmailWithExecutor(tx, email));
}

function requirePendingLocalActivation(principal: PrincipalCredentialRow | undefined): PrincipalCredentialRow {
  const pendingActivation: PrincipalCredentialRow | undefined = readPendingLocalActivation(principal);
  if (pendingActivation === undefined) {
    throw createInvalidBootstrapTokenError();
  }

  return pendingActivation;
}

function assertValidBootstrapToken(principal: PrincipalCredentialRow, tokenHash: string): void {
  if (!isBootstrapTokenValid(principal, tokenHash, new Date())) {
    throw createInvalidBootstrapTokenError();
  }
}

async function assertLocalPasswordActivationAllowed(
  tx: OrganizationUsersTransaction,
  principalId: string,
  organizationId: string,
): Promise<void> {
  if (!(await hasLocalPasswordEnabledOrganizationMembershipByIdWithExecutor(tx, principalId, organizationId))) {
    throw createInvalidBootstrapTokenError();
  }
}

async function requireActivationOrganizationForToken(
  executor: OrganizationQueryExecutor,
  principalId: string,
  bootstrapToken: string,
): Promise<OrganizationRow> {
  const organization: OrganizationRow | undefined = await findActivationOrganizationForToken(
    executor,
    principalId,
    bootstrapToken,
  );
  if (organization === undefined) {
    throw createInvalidBootstrapTokenError();
  }

  return organization;
}

async function findActivationOrganizationForToken(
  executor: OrganizationQueryExecutor,
  principalId: string,
  bootstrapToken: string,
): Promise<OrganizationRow | undefined> {
  const tokenScope: ScopedTokenScope = readScopedTokenScope(bootstrapToken);
  if (tokenScope.kind === 'organization') {
    return await findOrganizationRowForPrincipalByIdWithExecutor(executor, principalId, tokenScope.organizationId);
  }

  return undefined;
}

async function finalizePrincipalActivation(
  tx: OrganizationUsersTransaction,
  principalId: string,
  password: string,
  bootstrapTokenHash: string,
  organizationId: string,
): Promise<void> {
  const finalized: boolean = await finalizeLocalActivationWithExecutor(tx, {
    bootstrapTokenHash,
    organizationId,
    passwordHash: await argon2.hash(password),
    principalId,
    updatedAt: new Date(),
  });

  if (!finalized) {
    throw createInvalidBootstrapTokenError();
  }
}

async function recordActivationOperation(
  tx: OrganizationUsersTransaction,
  principal: PrincipalCredentialRow,
  organizationId: string,
): Promise<void> {
  await insertOperationRecordWithExecutor(tx, {
    actorPrincipalId: principal.principalId,
    completedAt: new Date(),
    organizationId,
    status: 'succeeded',
    summary: `Activated local access for ${principal.email}`,
    targetId: principal.principalId,
    targetType: 'principal',
    type: 'auth.activate',
  });
}

function buildActivateLocalUserResult(
  principal: PrincipalCredentialRow,
  session: AuthSessionPlan,
  organizations: OrganizationRow[],
): ActivateLocalUserResult {
  return {
    authSession: buildAuthSessionOrganizationPolicySession(session, principal.principalId),
    organizations,
    principalEmail: principal.email,
    principalId: principal.principalId,
    sessionExpiresAt: session.expiresAt,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  };
}
