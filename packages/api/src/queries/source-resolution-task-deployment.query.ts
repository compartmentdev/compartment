import { and, eq } from 'drizzle-orm';
import { sourceResolutionTaskDeployments } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import type {
  CreateSourceResolutionTaskDeploymentInput,
  PersistedSourceResolutionTaskDeploymentRow,
  SourceResolutionTaskDeploymentRow,
  SourceResolutionWriteExecutor,
} from './source-resolution.query.types';

export async function createSourceResolutionTaskDeployment(
  executor: SourceResolutionWriteExecutor,
  input: CreateSourceResolutionTaskDeploymentInput,
): Promise<SourceResolutionTaskDeploymentRow> {
  const created: SourceResolutionTaskDeploymentRow | undefined = await insertSourceResolutionTaskDeployment(
    executor,
    input,
  );
  if (created !== undefined) {
    return created;
  }

  return requirePersistedRow(
    await findSourceResolutionTaskDeployment(input.sourceResolutionTaskId, input.deploymentId),
    'source resolution task deployment',
  );
}

async function insertSourceResolutionTaskDeployment(
  executor: SourceResolutionWriteExecutor,
  input: CreateSourceResolutionTaskDeploymentInput,
): Promise<SourceResolutionTaskDeploymentRow | undefined> {
  const [row]: PersistedSourceResolutionTaskDeploymentRow[] = await executor
    .insert(sourceResolutionTaskDeployments)
    .values(input)
    .onConflictDoNothing({
      target: [sourceResolutionTaskDeployments.sourceResolutionTaskId, sourceResolutionTaskDeployments.deploymentId],
    })
    .returning();

  return row;
}

async function findSourceResolutionTaskDeployment(
  sourceResolutionTaskId: string,
  deploymentId: string,
): Promise<SourceResolutionTaskDeploymentRow | undefined> {
  const rows: PersistedSourceResolutionTaskDeploymentRow[] = await getApiDatabase()
    .select()
    .from(sourceResolutionTaskDeployments)
    .where(
      and(
        eq(sourceResolutionTaskDeployments.sourceResolutionTaskId, sourceResolutionTaskId),
        eq(sourceResolutionTaskDeployments.deploymentId, deploymentId),
      ),
    )
    .limit(1);

  return rows[0];
}
