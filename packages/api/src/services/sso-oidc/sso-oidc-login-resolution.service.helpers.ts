import type { CompartmentMembershipRole, EnabledSsoOidcProvisioningPolicy } from '@compartment/contracts';
import { createInvalidSsoLoginError } from '../../errors/api-business-error';
import { createId } from '../../lib/tokens';
import { createAuthSessionWithExecutor } from '../../queries/authentication.query';
import { createOrganizationMembershipWithExecutor } from '../../queries/organization-memberships.query';
import {
  createPrincipalIfMissingWithExecutor,
  findOrganizationMembershipAccessByPrincipalIdWithExecutor,
  lockPrincipalRowWithExecutor,
} from '../../queries/organization-users.query';
import type {
  OrganizationMembershipAccessRow,
  OrganizationUsersTransaction,
  PrincipalCredentialRow,
} from '../../queries/organization-users.query.types';
import { insertOperationRecordWithExecutor } from '../../queries/operations.query';
import { findPrincipalCredentialByEmailWithExecutor } from '../../queries/principal-credentials.query';
import { findOrganizationSsoPrincipalByIdWithExecutor } from '../../queries/sso-oidc-principal.query';
import type {
  LinkSsoOidcIdentityInput,
  SsoOidcPrincipalRow,
  SsoOidcProviderRow,
} from '../../queries/sso-oidc.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import { createAuthSessionPlan } from '../auth-session.service';
import type { AuthSessionPlan } from '../auth-session.types';
import { assignOrganizationSystemRoleToPrincipalWithExecutor } from '../rbac-seed.service';
import type { ResolveSsoOidcPrincipalResult } from './sso-oidc-login-resolution.service.types';
import { requireEnabledSsoOidcProvisioningPolicy } from './sso-oidc-provisioning-policy.service';

export async function persistResolvedSsoOidcLoginSession(
  transaction: OrganizationUsersTransaction,
  resolution: ResolveSsoOidcPrincipalResult,
  provider: SsoOidcProviderRow,
): Promise<AuthSessionPlan> {
  const session: AuthSessionPlan = createSsoOidcAuthSessionPlan(provider, resolution.principal.principalId);
  await createAuthSessionWithExecutor(transaction, {
    authMethodKind: session.authMethodKind,
    expiresAt: session.expiresAt,
    oidcProviderId: session.oidcProviderId,
    organizationId: session.organizationId,
    principalId: resolution.principal.principalId,
    sessionId: session.sessionId,
    tokenHash: session.tokenHash,
  });
  await recordResolvedSsoLoginOperations(transaction, resolution, provider);

  return session;
}

export function buildSsoOidcIdentity(
  provider: SsoOidcProviderRow,
  principalId: string,
  subject: string,
): LinkSsoOidcIdentityInput {
  return {
    id: createId('soi'),
    lastLoginAt: new Date(),
    principalId,
    providerId: provider.id,
    subject,
  };
}

export async function ensureProvisionedOrganizationMembership(
  transaction: OrganizationUsersTransaction,
  organizationId: string,
  principalId: string,
  role: CompartmentMembershipRole,
): Promise<void> {
  const principal: SsoOidcPrincipalRow | undefined = await findOrganizationSsoPrincipalByIdWithExecutor(
    transaction,
    organizationId,
    principalId,
  );
  if (principal !== undefined) {
    return;
  }
  await assertProvisioningMembershipIsNotBlocked(transaction, organizationId, principalId);

  await createOrganizationMembershipWithExecutor(transaction, {
    id: createId('mem'),
    organizationId,
    principalId,
  });
  await assignOrganizationSystemRoleToPrincipalWithExecutor(transaction, organizationId, principalId, role);
}

async function assertProvisioningMembershipIsNotBlocked(
  transaction: OrganizationUsersTransaction,
  organizationId: string,
  principalId: string,
): Promise<void> {
  const membership: OrganizationMembershipAccessRow | undefined =
    await findOrganizationMembershipAccessByPrincipalIdWithExecutor(transaction, organizationId, principalId);
  if (membership !== undefined && membership.blockedAt !== null) {
    throw createInvalidSsoLoginError();
  }
}

export async function resolveProvisioningPrincipalCredential(
  transaction: OrganizationUsersTransaction,
  verifiedEmail: string,
): Promise<PrincipalCredentialRow> {
  const existingPrincipalCredential: PrincipalCredentialRow | undefined =
    await findPrincipalCredentialByEmailWithExecutor(transaction, verifiedEmail);
  if (existingPrincipalCredential !== undefined) {
    return await lockProvisioningPrincipalCredential(transaction, existingPrincipalCredential);
  }

  await createProvisioningPrincipalCredential(transaction, verifiedEmail);

  return await requireProvisioningPrincipalCredential(transaction, verifiedEmail);
}

function createSsoOidcAuthSessionPlan(provider: SsoOidcProviderRow, principalId: string): AuthSessionPlan {
  return createAuthSessionPlan(
    {
      authMethodKind: 'oidc',
      oidcProviderId: provider.id,
      organizationId: provider.organizationId,
      principalId,
    },
    getApiConfig(),
  );
}

async function recordResolvedSsoLoginOperations(
  transaction: OrganizationUsersTransaction,
  resolution: ResolveSsoOidcPrincipalResult,
  provider: SsoOidcProviderRow,
): Promise<void> {
  if (resolution.autoJoined) {
    await recordSsoOidcAutoJoinOperation(transaction, resolution.principal, provider);
  }
  await recordSsoOidcLoginOperation(transaction, resolution.principal, provider);
}

async function recordSsoOidcAutoJoinOperation(
  transaction: OrganizationUsersTransaction,
  principal: SsoOidcPrincipalRow,
  provider: SsoOidcProviderRow,
): Promise<void> {
  const provisioningPolicy: EnabledSsoOidcProvisioningPolicy = requireEnabledSsoOidcProvisioningPolicy(
    provider.provisioning,
  );
  await recordPrincipalSsoOidcOperation(
    transaction,
    principal,
    provider.organizationId,
    `Auto-joined ${principal.principalEmail} with ${provider.displayName} as ${provisioningPolicy.defaultRole}`,
    'auth.sso_oidc.auto_join',
  );
}

async function recordSsoOidcLoginOperation(
  transaction: OrganizationUsersTransaction,
  principal: SsoOidcPrincipalRow,
  provider: SsoOidcProviderRow,
): Promise<void> {
  await recordPrincipalSsoOidcOperation(
    transaction,
    principal,
    provider.organizationId,
    `Logged in ${principal.principalEmail} with ${provider.displayName}`,
    'auth.sso_oidc.login',
  );
}

async function recordPrincipalSsoOidcOperation(
  transaction: OrganizationUsersTransaction,
  principal: SsoOidcPrincipalRow,
  organizationId: string,
  summary: string,
  type: 'auth.sso_oidc.auto_join' | 'auth.sso_oidc.login',
): Promise<void> {
  await insertOperationRecordWithExecutor(transaction, {
    actorPrincipalId: principal.principalId,
    completedAt: new Date(),
    organizationId,
    status: 'succeeded',
    summary,
    targetId: principal.principalId,
    targetType: 'principal',
    type,
  });
}

async function createProvisioningPrincipalCredential(
  transaction: OrganizationUsersTransaction,
  verifiedEmail: string,
): Promise<void> {
  await createPrincipalIfMissingWithExecutor(transaction, {
    email: verifiedEmail,
    principalId: createId('prn'),
  });
}

async function requireProvisioningPrincipalCredential(
  transaction: OrganizationUsersTransaction,
  verifiedEmail: string,
): Promise<PrincipalCredentialRow> {
  const principalCredential: PrincipalCredentialRow | undefined = await findPrincipalCredentialByEmailWithExecutor(
    transaction,
    verifiedEmail,
  );
  if (principalCredential === undefined) {
    throw new Error('Expected SSO auto-join to resolve a principal credential row.');
  }

  return await lockProvisioningPrincipalCredential(transaction, principalCredential);
}

async function lockProvisioningPrincipalCredential(
  transaction: OrganizationUsersTransaction,
  principalCredential: PrincipalCredentialRow,
): Promise<PrincipalCredentialRow> {
  await lockPrincipalRowWithExecutor(transaction, principalCredential.principalId);

  return principalCredential;
}
