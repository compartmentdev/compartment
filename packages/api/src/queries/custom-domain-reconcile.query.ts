import { and, asc, eq, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { deploymentCustomDomains } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import { claimSelectedRow } from './claim-row.query.shared';
import type {
  ClaimedCustomDomainReconcileRow,
  CustomDomainReconcileLeaseRow,
  FailCustomDomainReconcileInput,
  ObserveCustomDomainReconcileInput,
} from './custom-domain-reconcile.query.types';

const customDomainReconcileLeaseDurationMs: number = 120_000;
const customDomainObservationRetryDelayMs: number = 5_000;

interface CustomDomainReconcileSelectedRow extends Omit<CustomDomainReconcileLeaseRow, 'operation'> {
  reconcileState: string;
}

export async function claimCustomDomainReconcileRow(): Promise<ClaimedCustomDomainReconcileRow | null> {
  return await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<ClaimedCustomDomainReconcileRow | null> =>
      await claimSelectedRow(tx, lockClaimableCustomDomain, stampCustomDomainClaim, null),
  );
}

export async function observeCustomDomainReconcileRow(input: ObserveCustomDomainReconcileInput): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(deploymentCustomDomains)
    .set({
      observedCertificatePresent: input.certificatePresent,
      observedCertificateReady: input.certificateReady,
      observedGeneration: input.observedGeneration,
      observedIngressPresent: input.ingressPresent,
      reconcileLeaseExpiresAt: nextObservationLeaseExpiry(input.releaseLease),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deploymentCustomDomains.reconcileLeaseId, input.leaseId),
        eq(deploymentCustomDomains.desiredGeneration, input.observedGeneration),
        inArray(deploymentCustomDomains.reconcileState, ['reconciling', 'deleting']),
      ),
    )
    .returning({ id: deploymentCustomDomains.id });
  return rows.length === 1;
}

export async function readCustomDomainReconcileLease(
  leaseId: string,
  observedGeneration: number,
): Promise<CustomDomainReconcileLeaseRow | undefined> {
  const row: CustomDomainReconcileSelectedRow | undefined = await selectCustomDomainReconcileLease(
    leaseId,
    observedGeneration,
  );
  if (row === undefined) {
    return undefined;
  }
  return {
    ...row,
    operation: row.reconcileState === 'deleting' ? 'delete' : 'reconcile',
  };
}

async function selectCustomDomainReconcileLease(
  leaseId: string,
  observedGeneration: number,
): Promise<CustomDomainReconcileSelectedRow | undefined> {
  const [row]: CustomDomainReconcileSelectedRow[] = await getApiDatabase()
    .select({
      desiredGeneration: deploymentCustomDomains.desiredGeneration,
      domainId: deploymentCustomDomains.id,
      host: deploymentCustomDomains.host,
      observedCertificatePresent: deploymentCustomDomains.observedCertificatePresent,
      observedCertificateReady: deploymentCustomDomains.observedCertificateReady,
      observedGeneration: deploymentCustomDomains.observedGeneration,
      observedIngressPresent: deploymentCustomDomains.observedIngressPresent,
      reconcileState: deploymentCustomDomains.reconcileState,
    })
    .from(deploymentCustomDomains)
    .where(
      and(
        eq(deploymentCustomDomains.reconcileLeaseId, leaseId),
        eq(deploymentCustomDomains.desiredGeneration, observedGeneration),
      ),
    )
    .limit(1);
  return row;
}

export async function activateCustomDomainReconcileRow(leaseId: string, generation: number): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(deploymentCustomDomains)
    .set({
      failureMessage: null,
      reconcileLeaseExpiresAt: null,
      reconcileLeaseId: null,
      reconcileState: 'active',
      updatedAt: new Date(),
    })
    .where(
      and(
        ...buildReadyCustomDomainObservationPredicate(leaseId, generation),
        eq(deploymentCustomDomains.edgeRoutingEnabled, true),
        eq(deploymentCustomDomains.reconcileState, 'reconciling'),
      ),
    )
    .returning({ id: deploymentCustomDomains.id });
  return rows.length === 1;
}

export async function enableCustomDomainEdgeRouting(leaseId: string, generation: number): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(deploymentCustomDomains)
    .set({ edgeRoutingEnabled: true, updatedAt: new Date() })
    .where(
      and(
        ...buildReadyCustomDomainObservationPredicate(leaseId, generation),
        eq(deploymentCustomDomains.reconcileState, 'reconciling'),
      ),
    )
    .returning({ id: deploymentCustomDomains.id });
  return rows.length === 1;
}

function buildReadyCustomDomainObservationPredicate(leaseId: string, generation: number): SQL[] {
  return [
    eq(deploymentCustomDomains.reconcileLeaseId, leaseId),
    eq(deploymentCustomDomains.desiredGeneration, generation),
    eq(deploymentCustomDomains.observedGeneration, generation),
    eq(deploymentCustomDomains.observedIngressPresent, true),
    eq(deploymentCustomDomains.observedCertificatePresent, true),
    eq(deploymentCustomDomains.observedCertificateReady, true),
  ];
}

export async function settleDeletedCustomDomain(leaseId: string, generation: number): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .delete(deploymentCustomDomains)
    .where(
      and(
        eq(deploymentCustomDomains.reconcileLeaseId, leaseId),
        eq(deploymentCustomDomains.desiredGeneration, generation),
        eq(deploymentCustomDomains.observedGeneration, generation),
        eq(deploymentCustomDomains.observedIngressPresent, false),
        eq(deploymentCustomDomains.observedCertificatePresent, false),
        eq(deploymentCustomDomains.reconcileState, 'deleting'),
      ),
    )
    .returning({ id: deploymentCustomDomains.id });
  return rows.length === 1;
}

export async function failCustomDomainReconcileRow(input: FailCustomDomainReconcileInput): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(deploymentCustomDomains)
    .set({
      failureMessage: input.failureMessage,
      edgeRoutingEnabled: false,
      observedGeneration: input.observedGeneration,
      reconcileLeaseExpiresAt: null,
      reconcileLeaseId: null,
      reconcileState: 'failed',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deploymentCustomDomains.reconcileLeaseId, input.leaseId),
        eq(deploymentCustomDomains.desiredGeneration, input.observedGeneration),
        eq(deploymentCustomDomains.reconcileState, 'reconciling'),
      ),
    )
    .returning({ id: deploymentCustomDomains.id });
  return rows.length === 1;
}

async function lockClaimableCustomDomain(
  tx: ApiDatabaseTransaction,
): Promise<typeof deploymentCustomDomains.$inferSelect | undefined> {
  const now: Date = new Date();
  const [row] = await tx
    .select()
    .from(deploymentCustomDomains)
    .where(
      and(
        or(
          eq(deploymentCustomDomains.reconcileState, 'reconciling'),
          and(eq(deploymentCustomDomains.reconcileState, 'deleting'), eq(deploymentCustomDomains.deletionReady, true)),
        ),
        or(
          isNull(deploymentCustomDomains.reconcileLeaseExpiresAt),
          lt(deploymentCustomDomains.reconcileLeaseExpiresAt, now),
        ),
      ),
    )
    .orderBy(asc(deploymentCustomDomains.updatedAt), asc(deploymentCustomDomains.id))
    .limit(1)
    .for('update', { skipLocked: true });
  return row;
}

async function stampCustomDomainClaim(
  tx: ApiDatabaseTransaction,
  row: typeof deploymentCustomDomains.$inferSelect,
): Promise<ClaimedCustomDomainReconcileRow> {
  const leaseId: string = createId('lease');
  await tx
    .update(deploymentCustomDomains)
    .set({ reconcileLeaseExpiresAt: nextLeaseExpiry(), reconcileLeaseId: leaseId, updatedAt: new Date() })
    .where(eq(deploymentCustomDomains.id, row.id));
  return {
    desiredGeneration: row.desiredGeneration,
    domainId: row.id,
    host: row.host,
    leaseId,
    operation: row.reconcileState === 'deleting' ? 'delete' : 'reconcile',
  };
}

function nextLeaseExpiry(): Date {
  return new Date(Date.now() + customDomainReconcileLeaseDurationMs);
}

function nextObservationLeaseExpiry(releaseLease: boolean): Date {
  return new Date(
    Date.now() + (releaseLease ? customDomainObservationRetryDelayMs : customDomainReconcileLeaseDurationMs),
  );
}
