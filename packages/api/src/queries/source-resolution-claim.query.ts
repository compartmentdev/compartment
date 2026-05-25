import { sql, type SQL } from 'drizzle-orm';
import { sourceBindings, sourceResolutionTasks, sources } from '../db/schema';
import type { SourceResolutionMutationTransaction } from './source-resolution.query.types';

interface ClaimableSourceResolutionTaskRow {
  taskId: string;
}

const claimableSourceResolutionTaskQuery: SQL<ClaimableSourceResolutionTaskRow> = sql<ClaimableSourceResolutionTaskRow>`
  select
    candidate.id as "taskId"
  from (
    select
      ${sourceResolutionTasks.id} as id,
      ${sourceResolutionTasks.createdAt} as created_at
    from ${sourceResolutionTasks}
    inner join ${sources}
      on ${sources.id} = ${sourceResolutionTasks.sourceId}
    inner join ${sourceBindings}
      on ${sourceBindings.id} = ${sourceResolutionTasks.sourceBindingId}
    where ${sources.status} = ${'active'}
      and ${sourceBindings.status} = ${'active'}
      and ${sourceBindings.autoDeployEnabled} = ${true}
      and (
        ${sourceResolutionTasks.status} = ${'pending'}
        or (
          ${sourceResolutionTasks.status} = ${'claimed'}
          and ${sourceResolutionTasks.leaseExpiresAt} < now()
        )
      )
  ) as candidate
  inner join ${sourceResolutionTasks} locked_task
    on locked_task.id = candidate.id
  order by
    candidate.created_at,
    candidate.id
  for update of locked_task skip locked
  limit 1
`;

export async function findClaimableSourceResolutionTaskIdForUpdate(
  tx: SourceResolutionMutationTransaction,
): Promise<string | undefined> {
  const rows: object[] = (await tx.execute(claimableSourceResolutionTaskQuery)).rows;
  const task: ClaimableSourceResolutionTaskRow | undefined = rows[0] as ClaimableSourceResolutionTaskRow | undefined;

  return task?.taskId;
}
