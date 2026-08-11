import { and, asc, eq, gt, gte, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { organizationQuotaReconciliation } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import { claimSelectedRow } from './claim-row.query.shared';
import type {
  CompleteOrganizationQuotaReconcileInput,
  OrganizationQuotaInfrastructureBlockerRow,
  OrganizationQuotaReconcileClaimRow,
  OrganizationQuotaTransaction,
} from './organization-quota-reconciliation.query.types';

const organizationQuotaLeaseDurationMs: number = 300_000;
const organizationQuotaRetryDelayMs: number = 5_000;
const organizationQuotaReconciliationAttemptLimit: number = 3;
const organizationQuotaRecoveryDelayMs: number = 900_000;

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
  await failExpiredOrganizationQuotaLease(transaction);
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

async function failExpiredOrganizationQuotaLease(transaction: OrganizationQuotaTransaction): Promise<void> {
  await transaction
    .update(organizationQuotaReconciliation)
    .set({
      failureMessage: 'Organization quota reconciliation lease expired.',
      leaseExpiresAt: null,
      leaseId: null,
      state: 'failed',
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(organizationQuotaReconciliation.state, 'running'),
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
      .orderBy(
        organizationQuotaClaimPriority(),
        asc(organizationQuotaReconciliation.updatedAt),
        asc(organizationQuotaReconciliation.createdAt),
      )
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
      eq(organizationQuotaReconciliation.state, 'failed'),
      gte(organizationQuotaReconciliation.attempts, organizationQuotaReconciliationAttemptLimit),
      lt(
        organizationQuotaReconciliation.updatedAt,
        sql`now() - (${organizationQuotaRecoveryDelayMs} * interval '1 millisecond')`,
      ),
    ),
    and(
      eq(organizationQuotaReconciliation.state, 'succeeded'),
      lt(
        organizationQuotaReconciliation.updatedAt,
        sql`now() - (${organizationQuotaRecoveryDelayMs} * interval '1 millisecond')`,
      ),
    ),
  );
}

function organizationQuotaClaimPriority(): SQL {
  return sql`CASE WHEN ${organizationQuotaReconciliation.state} = 'succeeded' THEN 1 ELSE 0 END`;
}

async function leaseOrganizationQuota(
  transaction: OrganizationQuotaTransaction,
  row: typeof organizationQuotaReconciliation.$inferSelect,
): Promise<OrganizationQuotaReconcileClaimRow> {
  const leaseId: string = createId('oql');
  await transaction
    .update(organizationQuotaReconciliation)
    .set({
      attempts: row.state === 'succeeded' ? 1 : row.attempts + 1,
      leaseExpiresAt: sql`now() + (${organizationQuotaLeaseDurationMs} * interval '1 millisecond')`,
      leaseId,
      state: 'running',
      updatedAt: sql`now()`,
    })
    .where(eq(organizationQuotaReconciliation.organizationId, row.organizationId));
  return { leaseId, organizationId: row.organizationId };
}

export async function completeOrganizationQuotaReconciliation(
  input: CompleteOrganizationQuotaReconcileInput,
): Promise<boolean> {
  const rows = await getApiDatabase()
    .update(organizationQuotaReconciliation)
    .set({
      ...(input.status === 'succeeded' ? { attempts: 0 } : {}),
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

export async function readOrganizationQuotaInfrastructureBlocker(
  organizationId: string,
): Promise<OrganizationQuotaInfrastructureBlockerRow | null> {
  const row = (
    await getApiDatabase()
      .select({
        message: organizationQuotaReconciliation.failureMessage,
        updatedAt: organizationQuotaReconciliation.updatedAt,
      })
      .from(organizationQuotaReconciliation)
      .where(
        and(
          eq(organizationQuotaReconciliation.organizationId, organizationId),
          eq(organizationQuotaReconciliation.state, 'failed'),
          gte(organizationQuotaReconciliation.attempts, organizationQuotaReconciliationAttemptLimit),
          isNotNull(organizationQuotaReconciliation.failureMessage),
        ),
      )
      .limit(1)
  )[0];
  return row?.message === undefined || row.message === null
    ? null
    : {
        message: row.message,
        retryAt: new Date(row.updatedAt.getTime() + organizationQuotaRecoveryDelayMs),
      };
}
