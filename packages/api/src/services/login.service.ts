import argon2 from 'argon2';
import type { ApiConfig } from '../config';
import { createInvalidCredentialsError } from '../errors/api-business-error';
import { findLoginRowByEmailWithExecutor } from '../queries/login.query';
import type { LoginRow } from '../queries/login.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';
import type { OrganizationUsersTransaction } from '../queries/organization-users.query.types';
import { listOrganizationRowsForPrincipalWithExecutor } from '../queries/organizations.query';
import { insertOperationRecordWithExecutor } from '../queries/operations.query';
import { lockPrincipalByEmailWithExecutor } from '../queries/principal-credentials.query';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import {
  buildAuthSessionOrganizationPolicySession,
  createPasswordAuthSessionInput,
  issueAuthSessionWithExecutor,
} from './auth-session.service';
import type { AuthSessionPlan } from './auth-session.types';
import { readOrganizationAuthSettings } from './organization-auth-settings.service';
import type { LoginServiceInput, LoginServiceResult, OrganizationLoginServiceInput } from './login.service.types';

export async function login(input: LoginServiceInput): Promise<LoginServiceResult> {
  const config: ApiConfig = getApiConfig();

  return await getApiDatabase().transaction(async (tx: OrganizationUsersTransaction): Promise<LoginServiceResult> => {
    const principal: LoginRow = await getLockedLoginPrincipal(tx, input.email);

    await verifyLoginCredentials(principal, input.password);
    const organizations: OrganizationRow[] = await listOrganizationRowsForPrincipalWithExecutor(
      tx,
      principal.principalId,
    );
    if (organizations.length === 0) {
      throw createInvalidCredentialsError();
    }

    const session: AuthSessionPlan = await issuePasswordSession(tx, principal.principalId, null, config);
    await recordLoginOperation(tx, principal, null);

    return buildLoginResult(principal, session, organizations);
  });
}

export async function loginForOrganization(input: OrganizationLoginServiceInput): Promise<LoginServiceResult> {
  const config: ApiConfig = getApiConfig();
  const localPasswordEnabled: boolean = (await readOrganizationAuthSettings(input.organizationId)).localPasswordEnabled;

  return await getApiDatabase().transaction(async (tx: OrganizationUsersTransaction): Promise<LoginServiceResult> => {
    const principal: LoginRow = await getLockedLoginPrincipal(tx, input.email);
    const organizations: OrganizationRow[] = await requirePrincipalOrganizationsForLogin(
      tx,
      principal.principalId,
      input.organizationId,
    );

    assertLocalPasswordLoginEnabled(localPasswordEnabled);
    await verifyLoginCredentials(principal, input.password);

    const session: AuthSessionPlan = await issuePasswordSession(
      tx,
      principal.principalId,
      input.organizationId,
      config,
    );
    await recordLoginOperation(tx, principal, input.organizationId);

    return buildLoginResult(principal, session, organizations);
  });
}

async function getLockedLoginPrincipal(tx: OrganizationUsersTransaction, email: string): Promise<LoginRow> {
  await lockPrincipalByEmailWithExecutor(tx, email);

  return assertUserPrincipal(await findLoginRowByEmailWithExecutor(tx, email));
}

function assertUserPrincipal(principal: LoginRow | undefined): LoginRow {
  if (principal?.principalType !== 'user') {
    throw createInvalidCredentialsError();
  }

  return principal;
}

async function requirePrincipalOrganizationsForLogin(
  tx: OrganizationUsersTransaction,
  principalId: string,
  organizationId: string,
): Promise<OrganizationRow[]> {
  const organizations: OrganizationRow[] = await listOrganizationRowsForPrincipalWithExecutor(tx, principalId);
  if (!organizations.some((organization: OrganizationRow): boolean => organization.id === organizationId)) {
    throw createInvalidCredentialsError();
  }

  return organizations;
}

function assertLocalPasswordLoginEnabled(localPasswordEnabled: boolean): void {
  if (!localPasswordEnabled) {
    throw createInvalidCredentialsError();
  }
}

async function verifyLoginCredentials(principal: LoginRow, password: string): Promise<void> {
  await verifyPasswordLogin(principal, password);
}

async function verifyPasswordLogin(principal: LoginRow, password: string): Promise<void> {
  if (principal.passwordHash === null) {
    throw createInvalidCredentialsError();
  }

  const passwordMatches: boolean = await argon2.verify(principal.passwordHash, password);

  if (!passwordMatches) {
    throw createInvalidCredentialsError();
  }
}

async function issuePasswordSession(
  tx: OrganizationUsersTransaction,
  principalId: string,
  organizationId: string | null,
  config: ApiConfig,
): Promise<AuthSessionPlan> {
  return await issueAuthSessionWithExecutor(tx, createPasswordAuthSessionInput(principalId, organizationId), config);
}

async function recordLoginOperation(
  tx: OrganizationUsersTransaction,
  principal: LoginRow,
  organizationId: string | null,
): Promise<void> {
  await insertOperationRecordWithExecutor(tx, {
    actorPrincipalId: principal.principalId,
    completedAt: new Date(),
    organizationId,
    status: 'succeeded',
    summary: `Logged in ${principal.principalEmail}`,
    targetId: principal.principalId,
    targetType: 'principal',
    type: 'auth.login',
  });
}

function buildLoginResult(
  principal: LoginRow,
  session: AuthSessionPlan,
  organizations: OrganizationRow[],
): LoginServiceResult {
  return {
    authSession: buildAuthSessionOrganizationPolicySession(session, principal.principalId),
    organizations,
    principalEmail: principal.principalEmail,
    principalId: principal.principalId,
    sessionExpiresAt: session.expiresAt,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  };
}
