import type { ApiConfig } from '../config';
import { browserActivatePathname } from '../browser-public-paths';
import { createOrganizationUserExistsError, createUserNotManageableError } from '../errors/api-business-error';
import { createId, hashToken } from '../lib/tokens';
import { createOrganizationMembershipWithExecutor } from '../queries/organization-memberships.query';
import { insertOperationRecordWithExecutor } from '../queries/operations.query';
import {
  createEmptyLocalCredentialsWithExecutor,
  createPrincipalWithExecutor,
  findPrincipalCredentialByEmail,
  lockPrincipalRowWithExecutor,
  setBootstrapTokenWithExecutor,
} from '../queries/organization-users.query';
import type { OrganizationUsersTransaction, PrincipalCredentialRow } from '../queries/organization-users.query.types';
import { isUniqueConstraintError } from '../queries/query-error';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import { synchronizeEdgeAppAccessState } from './app-access-edge.service';
import { buildBrowserAuthTokenUrl } from './browser-auth-token-url.service';
import { readOrganizationAuthSettings } from './organization-auth-settings.service';
import {
  buildInviteOperation,
  buildInviteUserResult,
  readExistingOrganizationUser,
  requireInvitablePrincipal,
  shouldCreateLocalCredentials,
  type InvitationContext,
  type InvitationPlan,
} from './organization-users.service.helpers';
import type {
  InviteOrganizationUserInput,
  InviteOrganizationUserResult,
  OrganizationUserResult,
} from './organization-users.service.types';
import { createOrganizationScopedToken } from './scoped-token.service.helpers';

const invitationTtlMs: number = 7 * 24 * 60 * 60 * 1000;

export async function inviteUserToOrganization(
  input: InviteOrganizationUserInput,
): Promise<InviteOrganizationUserResult> {
  await assertOrganizationUserDoesNotExist(input.organizationId, input.email);
  const context: InvitationContext = await buildInvitationContext(
    input.email,
    input.organizationId,
    (await readOrganizationAuthSettings(input.organizationId)).localPasswordEnabled,
  );
  await persistOrganizationInvitation(input, context);
  await synchronizeEdgeAppAccessState();

  return buildInviteUserResult(
    await requireInvitedOrganizationUser(input.organizationId, input.email),
    context.invitation,
  );
}

async function assertOrganizationUserDoesNotExist(organizationId: string, email: string): Promise<void> {
  const existingUser: OrganizationUserResult | undefined = await readExistingOrganizationUser(organizationId, email);
  if (existingUser === undefined) {
    return;
  }
  if (existingUser.type !== 'user') {
    throw createUserNotManageableError();
  }

  throw createOrganizationUserExistsError();
}

async function buildInvitationContext(
  email: string,
  organizationId: string,
  localPasswordEnabled: boolean,
): Promise<InvitationContext> {
  const existingPrincipal: PrincipalCredentialRow | undefined = requireInvitablePrincipal(
    await findPrincipalCredentialByEmail(email),
  );

  return {
    existingPrincipal,
    invitation: buildInvitationPlan(email, organizationId, existingPrincipal, localPasswordEnabled),
    principalId: existingPrincipal?.principalId ?? createId('prn'),
  };
}

async function persistOrganizationInvitation(
  input: InviteOrganizationUserInput,
  context: InvitationContext,
): Promise<void> {
  try {
    await getApiDatabase().transaction(async (tx: OrganizationUsersTransaction): Promise<void> => {
      const updatedAt: Date = new Date();
      await createPrincipalIfNeeded(tx, input.email, context);
      await lockPrincipalRowWithExecutor(tx, context.principalId);
      await createLocalCredentialsIfNeeded(tx, context, updatedAt);
      await createMembershipInOrganization(tx, input.organizationId, context.principalId);
      await setInvitationBootstrapTokenIfNeeded(tx, context, updatedAt);
      await insertOperationRecordWithExecutor(tx, buildInviteOperation(input, context.principalId));
    });
  } catch (error) {
    throw mapInvitationPersistenceError(error instanceof Error ? error : undefined);
  }
}

function buildInvitationPlan(
  email: string,
  organizationId: string,
  existingPrincipal: PrincipalCredentialRow | undefined,
  localPasswordEnabled: boolean,
): InvitationPlan | null {
  if (!localPasswordEnabled || existingPrincipal !== undefined) {
    return null;
  }

  const config: ApiConfig = getApiConfig();
  const token: string = createOrganizationScopedToken(organizationId);
  const expiresAt: Date = new Date(Date.now() + invitationTtlMs);
  const activationUrl: string = buildBrowserAuthTokenUrl(browserActivatePathname, email, token, config);

  return {
    activationUrl,
    expiresAt,
    token,
    tokenHash: hashToken(token, config.sessionSecret),
  };
}

async function requireInvitedOrganizationUser(organizationId: string, email: string): Promise<OrganizationUserResult> {
  const user: OrganizationUserResult | undefined = await readExistingOrganizationUser(organizationId, email);
  if (user === undefined) {
    throw new Error(`Expected invited organization user for ${email}.`);
  }

  return user;
}

async function createPrincipalIfNeeded(
  tx: OrganizationUsersTransaction,
  email: string,
  context: InvitationContext,
): Promise<void> {
  if (context.existingPrincipal !== undefined) {
    return;
  }

  await createPrincipalWithExecutor(tx, {
    email,
    principalId: context.principalId,
  });
}

async function createLocalCredentialsIfNeeded(
  tx: OrganizationUsersTransaction,
  context: InvitationContext,
  updatedAt: Date,
): Promise<void> {
  if (context.invitation === null) {
    return;
  }
  if (!shouldCreateLocalCredentials(context.existingPrincipal)) {
    return;
  }

  await createEmptyLocalCredentialsWithExecutor(tx, context.principalId, updatedAt);
}

async function createMembershipInOrganization(
  tx: OrganizationUsersTransaction,
  organizationId: string,
  principalId: string,
): Promise<void> {
  await createOrganizationMembershipWithExecutor(tx, {
    id: createId('mem'),
    organizationId,
    principalId,
  });
}

async function setInvitationBootstrapTokenIfNeeded(
  tx: OrganizationUsersTransaction,
  context: InvitationContext,
  updatedAt: Date,
): Promise<void> {
  if (context.invitation === null) {
    return;
  }

  await setBootstrapTokenWithExecutor(tx, {
    bootstrapTokenExpiresAt: context.invitation.expiresAt,
    bootstrapTokenHash: context.invitation.tokenHash,
    principalId: context.principalId,
    updatedAt,
  });
}

function mapInvitationPersistenceError(error: Error | NodeJS.ErrnoException | null | undefined): Error {
  if (isUniqueConstraintError(error)) {
    throw createOrganizationUserExistsError();
  }

  return error ?? new Error('Failed to invite organization user.');
}
