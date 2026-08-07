import { and, asc, eq, gt, lt, or, type SQL } from 'drizzle-orm';
import { organizationQuotaReconciliation, projects } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import { claimSelectedRow } from './claim-row.query.shared';
import type {
  CompleteOrganizationQuotaReconcileInput,
  OrganizationQuotaReconcileClaimRow,
  OrganizationQuotaTransaction,
} from './organization-quota-reconciliation.query.types';

const organizationQuotaLeaseDurationMs: number = 300_000;
const organizationQuotaRetryDelayMs: number = 5_000;

export async function createOrganizationQuotaReconciliationWithExecutor(
  transaction: OrganizationQuotaTransaction,
  organizationId: string,
): Promise<void> {
  await transaction.insert(organizationQuotaReconciliation).values({ organizationId });
}

export async function claimOrganizationQuotaReconciliation(): Promise<OrganizationQuotaReconcileClaimRow | null> {
  return await getApiDatabase().transaction(
    async (transaction: OrganizationQuotaTransaction): Promise<OrganizationQuotaReconcileClaimRow | null> =>
      await claimOrganizationQuotaWithTransaction(transaction, new Date()),
  );
}

async function claimOrganizationQuotaWithTransaction(
  transaction: OrganizationQuotaTransaction,
  now: Date,
): Promise<OrganizationQuotaReconcileClaimRow | null> {
  return await claimSelectedRow(
    transaction,
    async (
      tx: OrganizationQuotaTransaction,
    ): Promise<typeof organizationQuotaReconciliation.$inferSelect | undefined> =>
      await selectClaimableOrganizationQuota(tx, now),
    async (
      tx: OrganizationQuotaTransaction,
      row: typeof organizationQuotaReconciliation.$inferSelect,
    ): Promise<OrganizationQuotaReconcileClaimRow> => await leaseOrganizationQuota(tx, row, now),
    null,
  );
}

async function selectClaimableOrganizationQuota(
  transaction: OrganizationQuotaTransaction,
  now: Date,
): Promise<typeof organizationQuotaReconciliation.$inferSelect | undefined> {
  return (
    await transaction
      .select()
      .from(organizationQuotaReconciliation)
      .where(organizationQuotaClaimableCondition(now))
      .orderBy(asc(organizationQuotaReconciliation.createdAt))
      .limit(1)
      .for('update', { skipLocked: true })
  )[0];
}

function organizationQuotaClaimableCondition(now: Date): SQL | undefined {
  return or(
    eq(organizationQuotaReconciliation.state, 'pending'),
    and(
      eq(organizationQuotaReconciliation.state, 'failed'),
      lt(organizationQuotaReconciliation.updatedAt, new Date(now.getTime() - organizationQuotaRetryDelayMs)),
    ),
    and(eq(organizationQuotaReconciliation.state, 'running'), lt(organizationQuotaReconciliation.leaseExpiresAt, now)),
  );
}

async function leaseOrganizationQuota(
  transaction: OrganizationQuotaTransaction,
  row: typeof organizationQuotaReconciliation.$inferSelect,
  now: Date,
): Promise<OrganizationQuotaReconcileClaimRow> {
  const leaseId: string = createId('oql');
  await transaction
    .update(organizationQuotaReconciliation)
    .set({
      attempts: row.state === 'running' ? row.attempts : row.attempts + 1,
      failureMessage: null,
      leaseExpiresAt: new Date(now.getTime() + organizationQuotaLeaseDurationMs),
      leaseId,
      state: 'running',
      updatedAt: now,
    })
    .where(eq(organizationQuotaReconciliation.organizationId, row.organizationId));
  const namespaceIds: string[] = (
    await transaction.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, row.organizationId))
  ).map(({ id }: { id: string }): string => id);
  return { leaseId, namespaceIds, organizationId: row.organizationId };
}

export async function completeOrganizationQuotaReconciliation(
  input: CompleteOrganizationQuotaReconcileInput,
): Promise<boolean> {
  const now: Date = new Date();
  const rows: { organizationId: string }[] = await getApiDatabase()
    .update(organizationQuotaReconciliation)
    .set({
      failureMessage: input.failureMessage,
      leaseExpiresAt: null,
      leaseId: null,
      state: input.status,
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationQuotaReconciliation.organizationId, input.organizationId),
        eq(organizationQuotaReconciliation.leaseId, input.leaseId),
        eq(organizationQuotaReconciliation.state, 'running'),
        gt(organizationQuotaReconciliation.leaseExpiresAt, now),
      ),
    )
    .returning({ organizationId: organizationQuotaReconciliation.organizationId });
  return rows.length === 1;
}
