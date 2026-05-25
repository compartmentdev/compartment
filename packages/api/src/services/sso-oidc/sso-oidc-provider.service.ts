import type { AppAccessBrowserFlowTarget, SsoOidcProviderPreset } from '@compartment/contracts';
import { appendOptionalSearchParam } from '@compartment/utils';
import { browserLoginSsoPathname } from '../../browser-public-paths';
import { createInvalidSsoProviderConfigError, createLoginMethodRequiredError } from '../../errors/api-business-error';
import { insertOperationRecord } from '../../queries/operations.query';
import { isUniqueConstraintError, readConstraintName } from '../../queries/query-error';
import { ssoOidcProviderOrganizationKeyUniqueConstraintName } from '../../sso-oidc.constants';
import { listActiveAuthenticationSessionIdsByOidcProvider } from '../../queries/authentication.query';
import {
  createSsoOidcProvider as insertSsoOidcProvider,
  deleteSsoOidcProviderByIdWithExecutor,
  listSsoOidcProvidersByOrganization,
  replaceSsoOidcProviderWithExecutor,
  updateSsoOidcProvider as persistSsoOidcProviderUpdate,
} from '../../queries/sso-oidc.query';
import type { RbacTransaction } from '../../queries/rbac.query.types';
import type { DeleteSsoOidcProviderResult, SsoOidcProviderRow } from '../../queries/sso-oidc.query.types';
import {
  buildCreateProviderInput,
  buildUpdateProviderInput,
  hasSsoOidcProviderTrustConfigChanged,
  readStoredClientSecret,
  requiresIdentityNamespaceReset,
  toSsoOidcProviderResult,
} from './sso-oidc-provider-config.service';
import { findOwnedSsoOidcProvider } from './sso-oidc-provider.service.helpers';
import { revokeAuthSessions } from '../auth-session-revocation.service';
import { runOrganizationAccessMutationTransaction } from '../rbac-admin-invariant.service';
import type {
  BrowserSsoProviderOption,
  CreateSsoOidcProviderInput,
  DeleteSsoOidcProviderInput,
  ResolvedUpdateSsoOidcProviderInput,
  SsoOidcProviderResult,
  UpdateSsoOidcProviderInput,
} from './sso-oidc.service.types';

type SsoOidcProviderOperationType = 'sso.oidc.create' | 'sso.oidc.delete' | 'sso.oidc.update';
type SsoOidcProviderMutationError = Error | NodeJS.ErrnoException | null | undefined;

interface SsoOidcProviderUpdatePlan {
  identityNamespaceResetRequired: boolean;
  sessionIdsToRevoke: string[];
  shouldRevokeSessions: boolean;
}

export async function createSsoOidcProvider(input: CreateSsoOidcProviderInput): Promise<SsoOidcProviderResult> {
  try {
    const provider: SsoOidcProviderRow = await insertSsoOidcProvider(buildCreateProviderInput(input));
    await recordSsoOidcProviderOperation(input, 'sso.oidc.create');

    return toSsoOidcProviderResult(provider);
  } catch (error) {
    throw mapSsoOidcProviderMutationError(error instanceof Error ? error : undefined);
  }
}

export async function updateSsoOidcProvider(input: UpdateSsoOidcProviderInput): Promise<SsoOidcProviderResult> {
  try {
    return await updateSsoOidcProviderUnchecked(input);
  } catch (error) {
    throw mapSsoOidcProviderMutationError(error instanceof Error ? error : undefined);
  }
}

async function updateSsoOidcProviderUnchecked(input: UpdateSsoOidcProviderInput): Promise<SsoOidcProviderResult> {
  const existingProvider: SsoOidcProviderRow = await requireOwnedSsoOidcProvider(
    input.organizationId,
    input.providerId,
  );
  const updateInput: ResolvedUpdateSsoOidcProviderInput = withExistingProviderConfig(input, existingProvider);
  const updatePlan: SsoOidcProviderUpdatePlan = await buildSsoOidcProviderUpdatePlan(
    existingProvider,
    input.organizationId,
    updateInput,
  );
  const provider: SsoOidcProviderRow = await persistSsoOidcProviderUpdatePlan(
    input.organizationId,
    existingProvider.id,
    updateInput,
    updatePlan,
  );
  await recordSsoOidcProviderOperation(input, 'sso.oidc.update');
  if (updatePlan.shouldRevokeSessions) {
    await revokeAuthSessions(updatePlan.sessionIdsToRevoke);
  }

  return toSsoOidcProviderResult(provider);
}

export async function readSsoOidcProvidersForOrganization(organizationId: string): Promise<SsoOidcProviderResult[]> {
  return (await listSsoOidcProvidersByOrganization(organizationId)).map(toSsoOidcProviderResult);
}

export async function deleteSsoOidcProvider(input: DeleteSsoOidcProviderInput): Promise<SsoOidcProviderResult> {
  const provider: SsoOidcProviderRow = await requireOwnedSsoOidcProvider(input.organizationId, input.providerId);
  const sessionIdsToRevoke: string[] = await listActiveAuthenticationSessionIdsByOidcProvider({
    oidcProviderId: input.providerId,
    organizationId: input.organizationId,
  });
  const result: DeleteSsoOidcProviderResult = await deleteSsoOidcProviderWithInvariant(input);
  if (result === 'login_method_required') {
    throw createLoginMethodRequiredError();
  }
  if (result === 'not_found') {
    throw createInvalidSsoProviderConfigError('SSO OIDC provider was not found.');
  }

  await recordSsoOidcProviderOperation(input, 'sso.oidc.delete');
  await revokeAuthSessions(sessionIdsToRevoke);
  return toSsoOidcProviderResult(provider);
}

async function persistSsoOidcProviderUpdatePlan(
  organizationId: string,
  providerId: string,
  updateInput: ResolvedUpdateSsoOidcProviderInput,
  updatePlan: SsoOidcProviderUpdatePlan,
): Promise<SsoOidcProviderRow> {
  if (!updatePlan.identityNamespaceResetRequired) {
    return await persistSsoOidcProviderUpdate(buildUpdateProviderInput(updateInput));
  }

  return await runOrganizationAccessMutationTransaction({
    organizationId,
    mutation: async (tx: RbacTransaction): Promise<SsoOidcProviderRow> =>
      await replaceSsoOidcProviderWithExecutor(tx, buildCreateProviderInput(updateInput, providerId)),
  });
}

async function deleteSsoOidcProviderWithInvariant(
  input: DeleteSsoOidcProviderInput,
): Promise<DeleteSsoOidcProviderResult> {
  return await runOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    mutation: async (tx: RbacTransaction): Promise<DeleteSsoOidcProviderResult> =>
      await deleteSsoOidcProviderByIdWithExecutor(tx, {
        organizationId: input.organizationId,
        providerId: input.providerId,
      }),
  });
}

export async function listBrowserSsoProviderOptionsForOrganization(
  organizationId: string,
  flowTarget: AppAccessBrowserFlowTarget | null,
): Promise<BrowserSsoProviderOption[]> {
  return (await listSsoOidcProvidersByOrganization(organizationId)).map(
    (provider: SsoOidcProviderRow): BrowserSsoProviderOption => ({
      buttonText: provider.buttonText,
      displayName: provider.displayName,
      loginUrl: buildBrowserSsoLoginUrl(provider.id, flowTarget),
      providerId: provider.id,
      preset: provider.preset,
    }),
  );
}

function buildBrowserSsoLoginUrl(providerId: string, flowTarget: AppAccessBrowserFlowTarget | null): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  searchParams.set('provider', providerId);
  if (flowTarget !== null) {
    appendOptionalSearchParam(searchParams, 'host', flowTarget.host);
    appendOptionalSearchParam(searchParams, 'path', flowTarget.path);
    appendOptionalSearchParam(searchParams, 'state', flowTarget.state);
  }

  return `${browserLoginSsoPathname}?${searchParams.toString()}`;
}

async function requireOwnedSsoOidcProvider(organizationId: string, providerId: string): Promise<SsoOidcProviderRow> {
  const provider: SsoOidcProviderRow | undefined = await findOwnedSsoOidcProvider(organizationId, providerId);
  if (provider === undefined) {
    throw createInvalidSsoProviderConfigError('The selected SSO provider was not found.');
  }

  return provider;
}

function withExistingProviderConfig(
  input: UpdateSsoOidcProviderInput,
  existingProvider: SsoOidcProviderRow,
): ResolvedUpdateSsoOidcProviderInput {
  const clientId: string = input.clientId ?? existingProvider.clientId;
  const clientSecret: string = input.clientSecret ?? readStoredClientSecret(existingProvider);
  const key: string = input.key ?? existingProvider.key;
  const preset: SsoOidcProviderPreset = input.preset ?? existingProvider.preset;

  return {
    ...input,
    buttonText: input.buttonText ?? existingProvider.buttonText,
    clientId,
    clientSecret,
    displayName: input.displayName ?? existingProvider.displayName,
    identityVerification: input.identityVerification ?? existingProvider.identityVerification,
    issuerUrl: input.issuerUrl ?? existingProvider.issuerUrl,
    key,
    preset,
    provisioning: input.provisioning ?? existingProvider.provisioning,
    scope: input.scope ?? existingProvider.scope,
  };
}

async function buildSsoOidcProviderUpdatePlan(
  existingProvider: SsoOidcProviderRow,
  organizationId: string,
  updateInput: ResolvedUpdateSsoOidcProviderInput,
): Promise<SsoOidcProviderUpdatePlan> {
  const identityNamespaceResetRequired: boolean = requiresIdentityNamespaceReset(existingProvider, updateInput);
  const shouldRevokeSessions: boolean = hasSsoOidcProviderTrustConfigChanged(
    existingProvider,
    updateInput,
    identityNamespaceResetRequired,
  );
  const sessionIdsToRevoke: string[] = shouldRevokeSessions
    ? await listActiveAuthenticationSessionIdsByOidcProvider({
        oidcProviderId: existingProvider.id,
        organizationId,
      })
    : [];

  return {
    identityNamespaceResetRequired,
    sessionIdsToRevoke,
    shouldRevokeSessions,
  };
}

async function recordSsoOidcProviderOperation(
  input: CreateSsoOidcProviderInput | DeleteSsoOidcProviderInput | UpdateSsoOidcProviderInput,
  type: SsoOidcProviderOperationType,
): Promise<void> {
  await insertOperationRecord({
    actorPrincipalId: input.actorPrincipalId,
    completedAt: new Date(),
    status: 'succeeded',
    summary: buildSsoOidcProviderOperationSummary(input.organizationSlug, type),
    targetId: input.organizationId,
    targetType: 'organization',
    type,
  });
}

function buildSsoOidcProviderOperationSummary(organizationSlug: string, type: SsoOidcProviderOperationType): string {
  return `${readSsoOidcProviderOperationAction(type)} SSO OIDC provider for ${organizationSlug}`;
}

function readSsoOidcProviderOperationAction(type: SsoOidcProviderOperationType): string {
  switch (type) {
    case 'sso.oidc.create':
      return 'Created';
    case 'sso.oidc.delete':
      return 'Deleted';
    case 'sso.oidc.update':
      return 'Updated';
  }
}

function mapSsoOidcProviderMutationError(error: SsoOidcProviderMutationError): Error {
  if (isSsoOidcProviderKeyCollision(error)) {
    return createInvalidSsoProviderConfigError('OIDC provider key is already in use in the current organization.');
  }

  return error instanceof Error ? error : new Error('Unknown SSO OIDC provider mutation failure.');
}

function isSsoOidcProviderKeyCollision(error: SsoOidcProviderMutationError): boolean {
  if (!(error instanceof Error) || !isUniqueConstraintError(error)) {
    return false;
  }

  return readConstraintName(error) === ssoOidcProviderOrganizationKeyUniqueConstraintName;
}
