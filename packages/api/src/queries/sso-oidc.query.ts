import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { ssoOidcFlows, ssoOidcIdentities, ssoOidcProviders } from '../db/schema';
import { hasEnabledLoginMethod } from '../lib/organization-login-method-policy';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  countSsoOidcProvidersWithExecutor,
  lockOrganizationLoginMethodMutation,
  readOrganizationLocalPasswordEnabledWithExecutor,
} from './organization-login-methods.query.helpers';
import { mapSsoOidcProviderRow, requireSsoOidcProvider } from './sso-oidc-provider.query.helpers';
import type {
  CreateSsoOidcProviderInput,
  CreateSsoOidcFlowInput,
  DeleteSsoOidcProviderInput,
  DeleteSsoOidcProviderResult,
  LinkSsoOidcIdentityInput,
  PersistedSsoOidcProviderRow,
  SsoOidcFlowRow,
  SsoOidcIdentityRow,
  SsoOidcProviderRow,
  UpdateSsoOidcProviderInput,
} from './sso-oidc.query.types';

interface SsoOidcProviderCreatedAtRow {
  createdAt: Date;
}

interface SsoOidcProviderIdRow {
  id: string;
}

type SsoOidcIdentityExecutor = Pick<Database, 'delete' | 'insert' | 'select' | 'update'>;

export async function listSsoOidcProvidersByOrganization(organizationId: string): Promise<SsoOidcProviderRow[]> {
  const rows: PersistedSsoOidcProviderRow[] = await getApiDatabase()
    .select()
    .from(ssoOidcProviders)
    .where(eq(ssoOidcProviders.organizationId, organizationId))
    .orderBy(asc(ssoOidcProviders.createdAt));

  return rows.map(
    (row: PersistedSsoOidcProviderRow): SsoOidcProviderRow => requireSsoOidcProvider(mapSsoOidcProviderRow(row)),
  );
}

export async function findSsoOidcProviderById(providerId: string): Promise<SsoOidcProviderRow | undefined> {
  const rows: PersistedSsoOidcProviderRow[] = await getApiDatabase()
    .select()
    .from(ssoOidcProviders)
    .where(eq(ssoOidcProviders.id, providerId))
    .limit(1);

  return mapSsoOidcProviderRow(rows[0]);
}

export async function createSsoOidcProvider(input: CreateSsoOidcProviderInput): Promise<SsoOidcProviderRow> {
  const [provider]: PersistedSsoOidcProviderRow[] = await getApiDatabase()
    .insert(ssoOidcProviders)
    .values(input)
    .returning();

  return requireSsoOidcProvider(mapSsoOidcProviderRow(provider));
}

export async function updateSsoOidcProvider(input: UpdateSsoOidcProviderInput): Promise<SsoOidcProviderRow> {
  return await updateSsoOidcProviderWithExecutor(getApiDatabase(), input);
}

async function updateSsoOidcProviderWithExecutor(
  executor: Database | ApiDatabaseTransaction,
  input: UpdateSsoOidcProviderInput,
): Promise<SsoOidcProviderRow> {
  const [provider]: PersistedSsoOidcProviderRow[] = await executor
    .update(ssoOidcProviders)
    .set({
      buttonText: input.buttonText,
      clientId: input.clientId,
      clientSecretCiphertext: input.clientSecretCiphertext,
      clientSecretEncryptionKeyId: input.clientSecretEncryptionKeyId,
      displayName: input.displayName,
      identityVerificationJson: input.identityVerificationJson,
      issuerUrl: input.issuerUrl,
      key: input.key,
      preset: input.preset,
      provisioningPolicyJson: input.provisioningPolicyJson,
      scope: input.scope,
      updatedAt: input.updatedAt,
    })
    .where(eq(ssoOidcProviders.id, input.providerId))
    .returning();

  return requireSsoOidcProvider(mapSsoOidcProviderRow(provider));
}

export async function replaceSsoOidcProviderWithExecutor(
  transaction: ApiDatabaseTransaction,
  input: CreateSsoOidcProviderInput,
): Promise<SsoOidcProviderRow> {
  const createdAt: Date = await readSsoOidcProviderCreatedAt(transaction, input.id);
  await transaction.delete(ssoOidcProviders).where(eq(ssoOidcProviders.id, input.id));

  const [provider]: PersistedSsoOidcProviderRow[] = await transaction
    .insert(ssoOidcProviders)
    .values({ ...input, createdAt })
    .returning();

  return requireSsoOidcProvider(mapSsoOidcProviderRow(provider));
}

export async function deleteSsoOidcProviderByIdWithExecutor(
  transaction: ApiDatabaseTransaction,
  input: DeleteSsoOidcProviderInput,
): Promise<DeleteSsoOidcProviderResult> {
  await lockOrganizationLoginMethodMutation(transaction, input.organizationId);
  const localPasswordEnabled: boolean = await readOrganizationLocalPasswordEnabledWithExecutor(
    transaction,
    input.organizationId,
  );
  const oidcProviderCount: number = await countSsoOidcProvidersWithExecutor(transaction, input.organizationId);
  if (!hasEnabledLoginMethod({ localPasswordEnabled, oidcProviderCount: oidcProviderCount - 1 })) {
    return 'login_method_required';
  }

  const rows: SsoOidcProviderIdRow[] = await transaction
    .delete(ssoOidcProviders)
    .where(and(eq(ssoOidcProviders.id, input.providerId), eq(ssoOidcProviders.organizationId, input.organizationId)))
    .returning({ id: ssoOidcProviders.id });

  return rows.length > 0 ? 'deleted' : 'not_found';
}

export async function deleteStaleSsoOidcFlows(now: Date): Promise<void> {
  await getApiDatabase()
    .delete(ssoOidcFlows)
    .where(or(lte(ssoOidcFlows.expiresAt, now), isNotNull(ssoOidcFlows.consumedAt)));
}

export async function createSsoOidcFlow(input: CreateSsoOidcFlowInput): Promise<void> {
  await getApiDatabase().insert(ssoOidcFlows).values(input);
}

export async function findSsoOidcFlowByStateHash(stateHash: string): Promise<SsoOidcFlowRow | undefined> {
  const rows: SsoOidcFlowRow[] = await getApiDatabase()
    .select()
    .from(ssoOidcFlows)
    .where(eq(ssoOidcFlows.stateHash, stateHash))
    .limit(1);

  return rows[0];
}

export async function consumeSsoOidcFlow(flowId: string, consumedAt: Date): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(ssoOidcFlows)
    .set({ consumedAt })
    .where(and(eq(ssoOidcFlows.id, flowId), isNull(ssoOidcFlows.consumedAt), gt(ssoOidcFlows.expiresAt, consumedAt)))
    .returning({ id: ssoOidcFlows.id });

  return rows.length > 0;
}

export async function findSsoOidcIdentityWithExecutor(
  executor: SsoOidcIdentityExecutor,
  providerId: string,
  subject: string,
): Promise<SsoOidcIdentityRow | undefined> {
  const rows: SsoOidcIdentityRow[] = await executor
    .select()
    .from(ssoOidcIdentities)
    .where(and(eq(ssoOidcIdentities.providerId, providerId), eq(ssoOidcIdentities.subject, subject)))
    .limit(1);

  return rows[0];
}

export async function linkSsoOidcIdentityWithExecutor(
  executor: SsoOidcIdentityExecutor,
  input: LinkSsoOidcIdentityInput,
): Promise<void> {
  await executor
    .insert(ssoOidcIdentities)
    .values(input)
    .onConflictDoNothing({
      target: [ssoOidcIdentities.providerId, ssoOidcIdentities.subject],
    });
}

export async function markSsoOidcIdentityLoginWithExecutor(
  executor: SsoOidcIdentityExecutor,
  identityId: string,
  lastLoginAt: Date,
): Promise<void> {
  await executor.update(ssoOidcIdentities).set({ lastLoginAt }).where(eq(ssoOidcIdentities.id, identityId));
}

export async function deleteSsoOidcIdentitiesByPrincipalIdWithExecutor(
  executor: SsoOidcIdentityExecutor,
  principalId: string,
): Promise<void> {
  await executor.delete(ssoOidcIdentities).where(eq(ssoOidcIdentities.principalId, principalId));
}

export async function deleteSsoOidcIdentitiesByPrincipalIdAndOrganizationIdWithExecutor(
  executor: SsoOidcIdentityExecutor,
  principalId: string,
  organizationId: string,
): Promise<void> {
  const providerRows: SsoOidcProviderIdRow[] = await executor
    .select({ id: ssoOidcProviders.id })
    .from(ssoOidcProviders)
    .where(eq(ssoOidcProviders.organizationId, organizationId));
  const providerIds: string[] = providerRows.map((row: SsoOidcProviderIdRow): string => row.id);
  if (providerIds.length === 0) {
    return;
  }

  await executor
    .delete(ssoOidcIdentities)
    .where(and(eq(ssoOidcIdentities.principalId, principalId), inArray(ssoOidcIdentities.providerId, providerIds)));
}

async function readSsoOidcProviderCreatedAt(transaction: ApiDatabaseTransaction, providerId: string): Promise<Date> {
  const rows: SsoOidcProviderCreatedAtRow[] = await transaction
    .select({ createdAt: ssoOidcProviders.createdAt })
    .from(ssoOidcProviders)
    .where(eq(ssoOidcProviders.id, providerId))
    .limit(1);

  const createdAt: Date | undefined = rows[0]?.createdAt;
  if (createdAt === undefined) {
    throw new Error('Expected SSO OIDC provider replacement to find the existing provider.');
  }

  return createdAt;
}
