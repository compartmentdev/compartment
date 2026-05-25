import { createLoginMethodRequiredError } from '../errors/api-business-error';
import { hasEnabledLoginMethod } from '../lib/organization-login-method-policy';
import { insertOperationRecord } from '../queries/operations.query';
import {
  findOrganizationAuthSettings,
  updateOrganizationAuthSettingsWithExecutor,
} from '../queries/organization-auth-settings.query';
import type { OrganizationAuthSettingsRow } from '../queries/organization-auth-settings.query.types';
import { countSsoOidcProvidersWithExecutor } from '../queries/organization-login-methods.query.helpers';
import { findOrganizationMembershipAccessByPrincipalIdWithExecutor } from '../queries/organization-users.query';
import type { OrganizationMembershipAccessRow } from '../queries/organization-users.query.types';
import type { RbacTransaction } from '../queries/rbac.query.types';
import { findSsoOidcProviderById } from '../queries/sso-oidc.query';
import type { SsoOidcProviderRow } from '../queries/sso-oidc.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import { revokeOrganizationPasswordSessions } from './auth-session-revocation.service';
import type {
  AuthSessionOrganizationPolicyInput,
  OrganizationAuthSettingsResult,
  UpdateOrganizationAuthSettingsInput,
} from './organization-auth-settings.service.types';
import { runOrganizationAccessMutationTransaction } from './rbac-admin-invariant.service';

export async function readOrganizationAuthSettings(organizationId: string): Promise<OrganizationAuthSettingsResult> {
  return toOrganizationAuthSettingsResult(await requireOrganizationAuthSettings(organizationId));
}

export async function updateOrganizationAuthSettings(
  input: UpdateOrganizationAuthSettingsInput,
): Promise<OrganizationAuthSettingsResult> {
  const existingSettings: OrganizationAuthSettingsRow = await requireOrganizationAuthSettings(input.organizationId);
  const settings: OrganizationAuthSettingsRow | null = await persistOrganizationAuthSettingsWithInvariant(input);
  if (settings === null) {
    throw createLoginMethodRequiredError();
  }
  await insertOperationRecord({
    actorPrincipalId: input.actorPrincipalId,
    completedAt: new Date(),
    status: 'succeeded',
    summary: `Updated auth settings for ${input.organizationSlug}`,
    targetId: input.organizationId,
    targetType: 'organization',
    type: 'auth.settings.update',
  });
  if (existingSettings.localPasswordEnabled && !settings.localPasswordEnabled) {
    await revokeOrganizationPasswordSessions(input.organizationId);
  }

  return toOrganizationAuthSettingsResult(settings);
}

async function persistOrganizationAuthSettingsWithInvariant(
  input: UpdateOrganizationAuthSettingsInput,
): Promise<OrganizationAuthSettingsRow | null> {
  return await runOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    mutation: async (tx: RbacTransaction): Promise<OrganizationAuthSettingsRow | null> => {
      const oidcProviderCount: number = await countSsoOidcProvidersWithExecutor(tx, input.organizationId);
      if (!hasEnabledLoginMethod({ localPasswordEnabled: input.localPasswordEnabled, oidcProviderCount })) {
        return null;
      }

      return await updateOrganizationAuthSettingsWithExecutor(tx, {
        localPasswordEnabled: input.localPasswordEnabled,
        organizationId: input.organizationId,
      });
    },
  });
}

export async function isAuthSessionAllowedForOrganization(input: AuthSessionOrganizationPolicyInput): Promise<boolean> {
  if (!(await hasActiveOrganizationMembership(input.organizationId, input.session.principalId))) {
    return false;
  }

  return await isAuthSessionPolicyAllowedForOrganization(input);
}

export async function isAuthSessionPolicyAllowedForOrganization(
  input: AuthSessionOrganizationPolicyInput,
): Promise<boolean> {
  if (input.session.authMethodKind === 'password') {
    return (await requireOrganizationAuthSettings(input.organizationId)).localPasswordEnabled;
  }
  if (input.session.authMethodKind === 'password_scoped') {
    return (
      input.session.organizationId === input.organizationId &&
      (await requireOrganizationAuthSettings(input.organizationId)).localPasswordEnabled
    );
  }
  if (input.session.oidcProviderId === null) {
    return false;
  }

  const provider: SsoOidcProviderRow | undefined = await findSsoOidcProviderById(input.session.oidcProviderId);
  if (provider === undefined) {
    return false;
  }

  if (input.session.organizationId !== null && input.session.organizationId !== input.organizationId) {
    return false;
  }

  return provider.organizationId === input.organizationId;
}

async function hasActiveOrganizationMembership(organizationId: string, principalId: string): Promise<boolean> {
  const membership: OrganizationMembershipAccessRow | undefined =
    await findOrganizationMembershipAccessByPrincipalIdWithExecutor(getApiDatabase(), organizationId, principalId);

  return membership?.blockedAt === null;
}

async function requireOrganizationAuthSettings(organizationId: string): Promise<OrganizationAuthSettingsRow> {
  const settings: OrganizationAuthSettingsRow | undefined = await findOrganizationAuthSettings(organizationId);
  if (settings === undefined) {
    throw new Error(`Organization auth settings for ${organizationId} were not found.`);
  }

  return settings;
}

function toOrganizationAuthSettingsResult(settings: OrganizationAuthSettingsRow): OrganizationAuthSettingsResult {
  return {
    localPasswordEnabled: settings.localPasswordEnabled,
  };
}
