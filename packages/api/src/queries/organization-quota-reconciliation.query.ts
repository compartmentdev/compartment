import { and, asc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';
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
const organizationQuotaReconciliationAttemptLimit: number = 3;

export async function createOrganizationQuotaReconciliationWithExecutor(
  transaction: OrganizationQuotaTransaction,
  organizationId: string,
): Promise<void> {
  await transaction.insert(organizationQuotaReconciliation).values({ organizationId });
}

export async function claimOrganizationQuotaReconciliation(): Promise<OrganizationQuotaReconcileClaimRow | null> {
  return await getApiDatabase().transaction(
    async (transaction: OrganizationQuotaTransaction): Promise<OrganizationQuotaReconcileClaimRow | null> =>
      await claimOrganizationQuotaWithTransaction(transaction),
  );
}

async function claimOrganizationQuotaWithTransaction(
  transaction: OrganizationQuotaTransaction,
): Promise<OrganizationQuotaReconcileClaimRow | null> {
  await failExhaustedOrganizationQuotaLease(transaction);
  return await claimSelectedRow(
    transaction,
    async (
      tx: OrganizationQuotaTransaction,
    ): Promise<typeof organizationQuotaReconciliation.$inferSelect | undefined> =>
      await selectClaimableOrganizationQuota(tx),
    async (
      tx: OrganizationQuotaTransaction,
      row: typeof organizationQuotaReconciliation.$inferSelect,
    ): Promise<OrganizationQuotaReconcileClaimRow> => await leaseOrganizationQuota(tx, row),
    null,
  );
}

async function failExhaustedOrganizationQuotaLease(transaction: OrganizationQuotaTransaction): Promise<void> {
  await transaction
    .update(organizationQuotaReconciliation)
    .set({
      failureMessage: `Organization quota reconciliation failed after ${organizationQuotaReconciliationAttemptLimit} attempts: the final lease expired.`,
      leaseExpiresAt: null,
      leaseId: null,
      state: 'failed',
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(organizationQuotaReconciliation.state, 'running'),
        gt(organizationQuotaReconciliation.attempts, organizationQuotaReconciliationAttemptLimit - 1),
        lt(organizationQuotaReconciliation.leaseExpiresAt, sql`now()`),
      ),
    );
}

async function selectClaimableOrganizationQuota(
  transaction: OrganizationQuotaTransaction,
): Promise<typeof organizationQuotaReconciliation.$inferSelect | undefined> {
  return (
    await transaction
      .select()
      .from(organizationQuotaReconciliation)
      .where(organizationQuotaClaimableCondition())
      .orderBy(asc(organizationQuotaReconciliation.createdAt))
      .limit(1)
      .for('update', { skipLocked: true })
  )[0];
}

function organizationQuotaClaimableCondition(): SQL | undefined {
  return or(
    eq(organizationQuotaReconciliation.state, 'pending'),
    and(
      eq(organizationQuotaReconciliation.state, 'failed'),
      lt(organizationQuotaReconciliation.attempts, organizationQuotaReconciliationAttemptLimit),
      lt(
        organizationQuotaReconciliation.updatedAt,
        sql`now() - (${organizationQuotaRetryDelayMs} * interval '1 millisecond')`,
      ),
    ),
    and(
      eq(organizationQuotaReconciliation.state, 'running'),
      lt(organizationQuotaReconciliation.attempts, organizationQuotaReconciliationAttemptLimit),
      lt(organizationQuotaReconciliation.leaseExpiresAt, sql`now()`),
    ),
  );
}

async function leaseOrganizationQuota(
  transaction: OrganizationQuotaTransaction,
  row: typeof organizationQuotaReconciliation.$inferSelect,
): Promise<OrganizationQuotaReconcileClaimRow> {
  const leaseId: string = createId('oql');
  await transaction
    .update(organizationQuotaReconciliation)
    .set({
      attempts: row.attempts + 1,
      failureMessage: null,
      leaseExpiresAt: sql`now() + (${organizationQuotaLeaseDurationMs} * interval '1 millisecond')`,
      leaseId,
      state: 'running',
      updatedAt: sql`now()`,
    })
    .where(eq(organizationQuotaReconciliation.organizationId, row.organizationId));
  const namespaceIds: string[] = (
    await transaction.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, row.organizationId))
  ).map(({ id }): string => id);
  return { leaseId, namespaceIds, organizationId: row.organizationId };
}

export async function completeOrganizationQuotaReconciliation(
  input: CompleteOrganizationQuotaReconcileInput,
): Promise<boolean> {
  const rows = await getApiDatabase()
    .update(organizationQuotaReconciliation)
    .set({
      failureMessage: input.failureMessage,
      leaseExpiresAt: null,
      leaseId: null,
      state: input.status,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(organizationQuotaReconciliation.organizationId, input.organizationId),
        eq(organizationQuotaReconciliation.leaseId, input.leaseId),
        eq(organizationQuotaReconciliation.state, 'running'),
        gt(organizationQuotaReconciliation.leaseExpiresAt, sql`now()`),
      ),
    )
    .returning({ organizationId: organizationQuotaReconciliation.organizationId });
  return rows.length === 1;
}
