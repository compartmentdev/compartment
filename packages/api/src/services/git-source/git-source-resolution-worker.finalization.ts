import type { JsonValue } from '@compartment/utils';
import { createId } from '../../lib/tokens';
import type { DeploymentRow } from '../../queries/deployments.query.types';
import {
  completeSourceResolutionTask,
  createSourceResolutionTaskDeployment,
  listNonTerminalSourceResolutionTaskEventIds,
  updateSourceEventStatus,
} from '../../queries/source-resolution.query';
import type { SourceResolutionTaskRow } from '../../queries/source-resolution.query.types';
import type { SourceBindingRow } from '../../queries/source.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import { deleteSourceResolutionTaskArchive } from './source-resolution-task-archive-storage.service';

export async function finalizeSourceResolutionTaskDeployments(
  task: SourceResolutionTaskRow,
  deployments: readonly DeploymentRow[],
): Promise<void> {
  await linkTaskDeployments(task, deployments);
  await completeSourceResolutionTaskAndCleanup(task);
}

export async function completeSourceResolutionTaskAndCleanup(
  task: SourceResolutionTaskRow,
  now: Date = new Date(),
): Promise<void> {
  await completeSourceResolutionTask(getApiDatabase(), {
    completedAt: now,
    id: task.id,
    updatedAt: now,
  });
  await completeSourceEventIfTerminal(task.sourceEventId, now);
  await deleteSourceResolutionTaskArchive(task.id);
}

export async function completeSourceEventIfTerminal(sourceEventId: string, now: Date): Promise<void> {
  if ((await listNonTerminalSourceResolutionTaskEventIds([sourceEventId])).length > 0) {
    return;
  }

  await updateSourceEventStatus(getApiDatabase(), {
    completedAt: now,
    sourceEventId,
    status: 'completed',
    updatedAt: now,
  });
}

export function readBindingWatchPaths(binding: SourceBindingRow): string[] {
  try {
    return readStringArrayJson(JSON.parse(binding.watchPathsJson) as JsonValue);
  } catch {
    return [];
  }
}

async function linkTaskDeployments(
  task: SourceResolutionTaskRow,
  deployments: readonly DeploymentRow[],
): Promise<void> {
  for (const deployment of deployments) {
    await createSourceResolutionTaskDeploymentLink(task.id, deployment.id);
  }
}

async function createSourceResolutionTaskDeploymentLink(
  sourceResolutionTaskId: string,
  deploymentId: string,
): Promise<void> {
  await createSourceResolutionTaskDeployment(getApiDatabase(), {
    deploymentId,
    id: createId('std'),
    sourceResolutionTaskId,
  });
}

function readStringArrayJson(value: JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry: JsonValue): entry is string => typeof entry === 'string');
}
