import { sql, type SQL } from 'drizzle-orm';
import { sourceSyncTasks, sources } from '../db/schema';
import type { SourceSyncMutationTransaction } from './source-sync.query.types';

interface ClaimableSourceSyncTaskRow {
  taskId: string;
}

const claimableSourceSyncTaskQuery: SQL<ClaimableSourceSyncTaskRow> = sql<ClaimableSourceSyncTaskRow>`
  select candidate.id as "taskId"
  from (
    select
      ${sourceSyncTasks.id} as id,
      ${sourceSyncTasks.createdAt} as created_at
    from ${sourceSyncTasks}
    inner join ${sources}
      on ${sources.id} = ${sourceSyncTasks.sourceId}
    where ${sources.status} = ${'active'}
      and (
        ${sourceSyncTasks.status} = ${'pending'}
        or (
          ${sourceSyncTasks.status} = ${'claimed'}
          and ${sourceSyncTasks.leaseExpiresAt} < now()
        )
      )
  ) as candidate
  inner join ${sourceSyncTasks} locked_task
    on locked_task.id = candidate.id
  order by candidate.created_at, candidate.id
  for update of locked_task skip locked
  limit 1
`;

export async function findClaimableSourceSyncTaskIdForUpdate(
  transaction: SourceSyncMutationTransaction,
): Promise<string | undefined> {
  const rows: object[] = (await transaction.execute(claimableSourceSyncTaskQuery)).rows;
  const task: ClaimableSourceSyncTaskRow | undefined = rows[0] as ClaimableSourceSyncTaskRow | undefined;

  return task?.taskId;
}
