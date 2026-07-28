import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { systemDomainIdempotencyKeys, systemDomainSetupState } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  buildClearedSystemDomainPendingValues,
  buildNextSystemDomainSetupVersion,
  buildVersionedSystemDomainSetupPredicate,
  defaultSystemDomainSetupStateId,
} from './system-domain-setup-state.helpers';
import type {
  StageSystemDomainPendingInput,
  ClearSystemDomainPendingInput,
  StoreSystemDomainIdempotencyKeyInput,
  SystemDomainIdempotencyKeyRow,
  SystemDomainMutationQueryResult,
  SystemDomainSetupStateRow,
  SystemDomainTransaction,
} from './system-domain.query.types';

const systemDomainMutationLockNamespace: number = 1_002;
const systemDomainMutationLockKey: number = 1;

type SystemDomainIdempotencyLookupExecutor = Pick<Database, 'select'>;
type SystemDomainSetupStateLookupExecutor = Pick<Database, 'select'>;

interface StageSystemDomainPendingValues {
  setupVersion: SQL;
  pendingBaseDomain: string;
  pendingCertificateMetadataJson: null;
  pendingTlsSecretName: null;
  pendingDomainKind: string;
  pendingIssuerRefJson: string | null;
  pendingFailureCode: null;
  pendingFailureMessage: null;
  pendingOperationId: string;
  pendingPublicScheme: string;
  pendingRequiredDnsRecordsJson: string;
  pendingStatus: 'pending_dns';
  pendingTlsMode: string;
  updatedAt: Date;
}

export async function findSystemDomainSetupState(): Promise<SystemDomainSetupStateRow | undefined> {
  return await findSystemDomainSetupStateWithExecutor(getApiDatabase());
}

export async function findSystemDomainSetupStateWithExecutor(
  executor: SystemDomainSetupStateLookupExecutor,
): Promise<SystemDomainSetupStateRow | undefined> {
  const rows: SystemDomainSetupStateRow[] = await executor
    .select()
    .from(systemDomainSetupState)
    .where(eq(systemDomainSetupState.id, defaultSystemDomainSetupStateId))
    .limit(1);

  return rows[0];
}

export async function findSystemDomainIdempotencyKeyWithExecutor(
  executor: SystemDomainIdempotencyLookupExecutor,
  idempotencyKey: string,
): Promise<SystemDomainIdempotencyKeyRow | undefined> {
  const rows: SystemDomainIdempotencyKeyRow[] = await executor
    .select()
    .from(systemDomainIdempotencyKeys)
    .where(eq(systemDomainIdempotencyKeys.idempotencyKey, idempotencyKey))
    .limit(1);

  return rows[0];
}

export async function runSystemDomainMutation<TResult>(
  callback: (tx: SystemDomainTransaction) => Promise<TResult>,
): Promise<TResult> {
  return await getApiDatabase().transaction(callback);
}

export async function acquireSystemDomainMutationLockWithExecutor(tx: SystemDomainTransaction): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${systemDomainMutationLockNamespace}, ${systemDomainMutationLockKey})`,
  );
}

export async function storeSystemDomainIdempotencyKeyWithExecutor(
  tx: SystemDomainTransaction,
  input: StoreSystemDomainIdempotencyKeyInput,
): Promise<void> {
  await tx.insert(systemDomainIdempotencyKeys).values(input);
}

export async function stageSystemDomainPendingWithExecutor(
  tx: SystemDomainTransaction,
  input: StageSystemDomainPendingInput,
): Promise<SystemDomainMutationQueryResult | null> {
  const [updatedSetupState]: SystemDomainSetupStateRow[] = await tx
    .update(systemDomainSetupState)
    .set(buildStageSystemDomainPendingValues(input))
    .where(buildVersionedSystemDomainSetupPredicate(input.expectedSetupVersion))
    .returning();

  if (updatedSetupState !== undefined) {
    return { operationId: input.operationId, setupState: updatedSetupState };
  }

  if (input.expectedSetupVersion !== 0) {
    return null;
  }

  const [insertedSetupState]: SystemDomainSetupStateRow[] = await tx
    .insert(systemDomainSetupState)
    .values(buildInitialStageSystemDomainPendingValues(input))
    .onConflictDoNothing()
    .returning();

  return insertedSetupState === undefined ? null : { operationId: input.operationId, setupState: insertedSetupState };
}

export async function clearSystemDomainPendingWithExecutor(
  tx: SystemDomainTransaction,
  input: ClearSystemDomainPendingInput,
): Promise<SystemDomainMutationQueryResult | null> {
  const [updatedSetupState]: SystemDomainSetupStateRow[] = await tx
    .update(systemDomainSetupState)
    .set(buildClearedSystemDomainPendingValues())
    .where(buildPendingSystemDomainPredicate(input.expectedSetupVersion, input.operationId))
    .returning();

  return updatedSetupState === undefined ? null : { operationId: input.operationId, setupState: updatedSetupState };
}

function buildInitialStageSystemDomainPendingValues(
  input: StageSystemDomainPendingInput,
): StageSystemDomainPendingValues & { id: string } {
  return {
    ...buildStageSystemDomainPendingValues(input),
    id: defaultSystemDomainSetupStateId,
    setupVersion: sql`1`,
  };
}

function buildStageSystemDomainPendingValues(input: StageSystemDomainPendingInput): StageSystemDomainPendingValues {
  return {
    setupVersion: buildNextSystemDomainSetupVersion(),
    pendingBaseDomain: input.pendingBaseDomain,
    pendingCertificateMetadataJson: null,
    pendingTlsSecretName: null,
    pendingDomainKind: input.pendingDomainKind,
    pendingIssuerRefJson: input.pendingIssuerRefJson,
    pendingFailureCode: null,
    pendingFailureMessage: null,
    pendingOperationId: input.operationId,
    pendingPublicScheme: input.pendingPublicScheme,
    pendingRequiredDnsRecordsJson: input.pendingRequiredDnsRecordsJson,
    pendingStatus: 'pending_dns',
    pendingTlsMode: input.pendingTlsMode,
    updatedAt: new Date(),
  };
}

function buildPendingSystemDomainPredicate(expectedVersion: number, operationId: string): SQL | undefined {
  return and(
    buildVersionedSystemDomainSetupPredicate(expectedVersion),
    isNotNull(systemDomainSetupState.pendingStatus),
    eq(systemDomainSetupState.pendingOperationId, operationId),
  );
}
