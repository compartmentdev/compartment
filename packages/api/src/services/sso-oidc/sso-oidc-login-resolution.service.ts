import type { EnabledSsoOidcProvisioningPolicy } from '@compartment/contracts';
import { createInvalidSsoLoginError } from '../../errors/api-business-error';
import type {
  OrganizationUsersTransaction,
  PrincipalCredentialRow,
} from '../../queries/organization-users.query.types';
import {
  findSsoOidcIdentityWithExecutor,
  linkSsoOidcIdentityWithExecutor,
  markSsoOidcIdentityLoginWithExecutor,
} from '../../queries/sso-oidc.query';
import {
  findOrganizationSsoPrincipalByEmailWithExecutor,
  findOrganizationSsoPrincipalByIdWithExecutor,
} from '../../queries/sso-oidc-principal.query';
import type { SsoOidcIdentityRow, SsoOidcPrincipalRow, SsoOidcProviderRow } from '../../queries/sso-oidc.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import type { AuthSessionPlan } from '../auth-session.types';
import type {
  ResolveSsoOidcLoginSessionInput,
  ResolveSsoOidcLoginSessionResult,
  ResolveSsoOidcPrincipalResult,
} from './sso-oidc-login-resolution.service.types';
import {
  buildSsoOidcIdentity,
  ensureProvisionedOrganizationMembership,
  persistResolvedSsoOidcLoginSession,
  resolveProvisioningPrincipalCredential,
} from './sso-oidc-login-resolution.service.helpers';
import {
  canAutoJoinWithSsoOidcClaims,
  requireEnabledSsoOidcProvisioningPolicy,
  requireVerifiedEmailForSsoOidcClaims,
} from './sso-oidc-provisioning-policy.service';

export async function resolveSsoOidcLoginSession(
  input: ResolveSsoOidcLoginSessionInput,
): Promise<ResolveSsoOidcLoginSessionResult> {
  return await getApiDatabase().transaction(
    async (transaction: OrganizationUsersTransaction): Promise<ResolveSsoOidcLoginSessionResult> => {
      const resolution: ResolveSsoOidcPrincipalResult = await resolveSsoOidcPrincipal(transaction, input);
      const session: AuthSessionPlan = await persistResolvedSsoOidcLoginSession(
        transaction,
        resolution,
        input.provider,
      );

      return {
        principal: resolution.principal,
        session,
      };
    },
  );
}

async function resolveSsoOidcPrincipal(
  transaction: OrganizationUsersTransaction,
  input: ResolveSsoOidcLoginSessionInput,
): Promise<ResolveSsoOidcPrincipalResult> {
  const identityPrincipal: ResolveSsoOidcPrincipalResult | undefined = await tryResolveExistingIdentityPrincipal(
    transaction,
    input,
  );
  if (identityPrincipal !== undefined) {
    return identityPrincipal;
  }
  const verifiedEmail: string = requireVerifiedEmailForSsoOidcClaims(input.claims);
  const existingPrincipal: SsoOidcPrincipalRow | undefined = await tryResolveExistingOrganizationPrincipal(
    transaction,
    input.provider,
    verifiedEmail,
    input.claims.subject,
  );
  if (existingPrincipal !== undefined) {
    return buildResolvedPrincipalResult(false, existingPrincipal);
  }

  return await resolveAutoJoinedPrincipalResult(transaction, input, verifiedEmail);
}

async function resolveAutoJoinedPrincipalResult(
  transaction: OrganizationUsersTransaction,
  input: ResolveSsoOidcLoginSessionInput,
  verifiedEmail: string,
): Promise<ResolveSsoOidcPrincipalResult> {
  if (!canAutoJoinWithSsoOidcClaims(input.provider.provisioning, input.claims)) {
    throw createInvalidSsoLoginError();
  }

  return buildResolvedPrincipalResult(
    true,
    await provisionSsoOidcPrincipal(transaction, input.provider, verifiedEmail, input.claims.subject),
  );
}

async function tryResolveExistingIdentityPrincipal(
  transaction: OrganizationUsersTransaction,
  input: ResolveSsoOidcLoginSessionInput,
): Promise<ResolveSsoOidcPrincipalResult | undefined> {
  const existingIdentity: SsoOidcIdentityRow | undefined = await findSsoOidcIdentityWithExecutor(
    transaction,
    input.provider.id,
    input.claims.subject,
  );
  if (existingIdentity === undefined) {
    return undefined;
  }

  await markSsoOidcIdentityLoginWithExecutor(transaction, existingIdentity.id, new Date());

  const existingPrincipal: SsoOidcPrincipalRow | undefined = await findExistingIdentityOrganizationPrincipal(
    transaction,
    input.provider.organizationId,
    existingIdentity.principalId,
  );
  if (existingPrincipal?.principalType === 'user') {
    return buildResolvedPrincipalResult(false, existingPrincipal);
  }

  return await restoreExistingIdentityPrincipal(transaction, input, existingIdentity.principalId);
}

async function tryResolveExistingOrganizationPrincipal(
  transaction: OrganizationUsersTransaction,
  provider: SsoOidcProviderRow,
  verifiedEmail: string,
  subject: string,
): Promise<SsoOidcPrincipalRow | undefined> {
  const existingPrincipal: SsoOidcPrincipalRow | undefined = await findOrganizationSsoPrincipalByEmailWithExecutor(
    transaction,
    provider.organizationId,
    verifiedEmail,
  );
  if (existingPrincipal?.principalType !== 'user') {
    return undefined;
  }

  await linkSsoOidcIdentityWithExecutor(
    transaction,
    buildSsoOidcIdentity(provider, existingPrincipal.principalId, subject),
  );

  return existingPrincipal;
}

async function provisionSsoOidcPrincipal(
  transaction: OrganizationUsersTransaction,
  provider: SsoOidcProviderRow,
  verifiedEmail: string,
  subject: string,
): Promise<SsoOidcPrincipalRow> {
  const provisioningPolicy: EnabledSsoOidcProvisioningPolicy = requireEnabledSsoOidcProvisioningPolicy(
    provider.provisioning,
  );
  const principalCredential: PrincipalCredentialRow = await resolveProvisioningPrincipalCredential(
    transaction,
    verifiedEmail,
  );
  await ensureProvisionedOrganizationMembership(
    transaction,
    provider.organizationId,
    principalCredential.principalId,
    provisioningPolicy.defaultRole,
  );
  await linkSsoOidcIdentityWithExecutor(
    transaction,
    buildSsoOidcIdentity(provider, principalCredential.principalId, subject),
  );

  return await requireOrganizationPrincipalById(transaction, provider.organizationId, principalCredential.principalId);
}

async function findExistingIdentityOrganizationPrincipal(
  transaction: OrganizationUsersTransaction,
  organizationId: string,
  principalId: string,
): Promise<SsoOidcPrincipalRow | undefined> {
  return await findOrganizationSsoPrincipalByIdWithExecutor(transaction, organizationId, principalId);
}

async function restoreExistingIdentityPrincipal(
  transaction: OrganizationUsersTransaction,
  input: ResolveSsoOidcLoginSessionInput,
  principalId: string,
): Promise<ResolveSsoOidcPrincipalResult> {
  if (!canAutoJoinWithSsoOidcClaims(input.provider.provisioning, input.claims)) {
    throw createInvalidSsoLoginError();
  }

  return buildResolvedPrincipalResult(
    true,
    await restoreSsoOidcIdentityMembership(transaction, input.provider, principalId),
  );
}

function buildResolvedPrincipalResult(
  autoJoined: boolean,
  principal: SsoOidcPrincipalRow,
): ResolveSsoOidcPrincipalResult {
  return {
    autoJoined,
    principal,
  };
}

async function restoreSsoOidcIdentityMembership(
  transaction: OrganizationUsersTransaction,
  provider: SsoOidcProviderRow,
  principalId: string,
): Promise<SsoOidcPrincipalRow> {
  const provisioningPolicy: EnabledSsoOidcProvisioningPolicy = requireEnabledSsoOidcProvisioningPolicy(
    provider.provisioning,
  );
  await ensureProvisionedOrganizationMembership(
    transaction,
    provider.organizationId,
    principalId,
    provisioningPolicy.defaultRole,
  );

  return await requireOrganizationPrincipalById(transaction, provider.organizationId, principalId);
}

async function requireOrganizationPrincipalById(
  transaction: OrganizationUsersTransaction,
  organizationId: string,
  principalId: string,
): Promise<SsoOidcPrincipalRow> {
  const principal: SsoOidcPrincipalRow | undefined = await findOrganizationSsoPrincipalByIdWithExecutor(
    transaction,
    organizationId,
    principalId,
  );
  if (principal?.principalType !== 'user') {
    throw createInvalidSsoLoginError();
  }

  return principal;
}
