import type { CustomDomainState } from '@compartment/contracts';
import { and, eq } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { deploymentCustomDomains } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { CustomDomainDeletionTransition } from './custom-domain-reconcile.query.types';

interface CustomDomainDeletionSourceRow {
  desiredGeneration: number;
  reconcileState: string;
}

export async function beginCustomDomainDeletion(domainId: string): Promise<CustomDomainDeletionTransition | null> {
  return await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<CustomDomainDeletionTransition | null> => {
      const row: CustomDomainDeletionSourceRow | undefined = await lockCustomDomainForDeletion(tx, domainId);
      if (row === undefined || !isRemovableCustomDomainState(row.reconcileState)) {
        return null;
      }
      const deletionGeneration: number =
        row.reconcileState === 'deleting' ? row.desiredGeneration : row.desiredGeneration + 1;
      await stampCustomDomainDeletion(tx, domainId, deletionGeneration);
      return {
        deletionGeneration,
        previousGeneration: row.desiredGeneration,
        previousState: row.reconcileState,
      };
    },
  );
}

async function lockCustomDomainForDeletion(
  tx: ApiDatabaseTransaction,
  domainId: string,
): Promise<CustomDomainDeletionSourceRow | undefined> {
  const [row]: CustomDomainDeletionSourceRow[] = await tx
    .select({
      desiredGeneration: deploymentCustomDomains.desiredGeneration,
      reconcileState: deploymentCustomDomains.reconcileState,
    })
    .from(deploymentCustomDomains)
    .where(eq(deploymentCustomDomains.id, domainId))
    .for('update');
  return row;
}

async function stampCustomDomainDeletion(
  tx: ApiDatabaseTransaction,
  domainId: string,
  deletionGeneration: number,
): Promise<void> {
  await tx
    .update(deploymentCustomDomains)
    .set({
      deletionReady: false,
      desiredGeneration: deletionGeneration,
      edgeRoutingEnabled: false,
      failureMessage: null,
      reconcileLeaseId: null,
      reconcileState: 'deleting',
      updatedAt: new Date(),
    })
    .where(eq(deploymentCustomDomains.id, domainId));
}

export async function markCustomDomainDeletionReady(domainId: string, generation: number): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(deploymentCustomDomains)
    .set({ deletionReady: true, updatedAt: new Date() })
    .where(
      and(
        eq(deploymentCustomDomains.id, domainId),
        eq(deploymentCustomDomains.desiredGeneration, generation),
        eq(deploymentCustomDomains.reconcileState, 'deleting'),
      ),
    )
    .returning({ id: deploymentCustomDomains.id });
  return rows.length === 1;
}

function isRemovableCustomDomainState(state: string): state is CustomDomainState {
  return (
    state === 'active' || state === 'deleting' || state === 'failed' || state === 'pending' || state === 'reconciling'
  );
}
