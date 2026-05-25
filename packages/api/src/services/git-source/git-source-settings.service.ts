import { getApiDatabase } from '../../runtime/runtime-access';
import { updateSourceSettings } from '../../queries/source.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import { buildGitSourceSettingsView } from './git-source-view.service';
import { requireActiveConnectedSource, requireConnectedSource } from './git-source.service.support';
import type {
  GitSourceSettingsView,
  MutateGitSourceExclusionInput,
  ReadGitSourceSettingsInput,
  UpdateGitSourceSettingsInput,
} from './git-source.service.types';
import type { GitSourceSyncTaskView } from './git-source-sync.service.types';
import {
  excludeGitSourceDescriptorWithinTransaction,
  includeGitSourceDescriptorWithinTransaction,
} from './git-source-exclusion.service';
import { readGitSourceSyncTask } from './git-source-sync.service';
import { readOrCreateGitSourceSyncTaskIdForInclude } from './git-source-sync-task.service';

export async function readGitSourceSettings(input: ReadGitSourceSettingsInput): Promise<GitSourceSettingsView> {
  return await buildGitSourceSettingsView(await requireConnectedSource(input));
}

export async function updateGitSourceSettingsForSource(
  input: UpdateGitSourceSettingsInput,
): Promise<GitSourceSettingsView> {
  const source: SourceRow = await requireConnectedSource(input);
  const updatedSource: SourceRow = await getApiDatabase().transaction(
    async (transaction: SourceMutationTransaction): Promise<SourceRow> =>
      await updateSourceSettings(transaction, {
        autoAdoptNewApps: input.autoAdoptNewApps,
        sourceId: source.id,
        updatedAt: new Date(),
      }),
  );

  return await buildGitSourceSettingsView(updatedSource);
}

export async function excludeGitSourceDescriptor(input: MutateGitSourceExclusionInput): Promise<void> {
  const source: SourceRow = await requireConnectedSource(input);
  await getApiDatabase().transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
    const now: Date = new Date();
    await excludeGitSourceDescriptorWithinTransaction(
      transaction,
      source.id,
      input.descriptorPath,
      input.actor.principalId,
      now,
    );
  });
}

export async function includeGitSourceDescriptor(input: MutateGitSourceExclusionInput): Promise<GitSourceSyncTaskView> {
  const source: SourceRow = await requireActiveConnectedSource(input);
  const taskId: string = await getApiDatabase().transaction(
    async (transaction: SourceMutationTransaction): Promise<string> => {
      await includeGitSourceDescriptorWithinTransaction(transaction, source.id, input.descriptorPath);
      return await readOrCreateGitSourceSyncTaskIdForInclude(
        transaction,
        source,
        input.descriptorPath,
        input.actor.principalId,
      );
    },
  );

  return await readGitSourceSyncTask({
    actor: input.actor,
    organizationId: input.organizationId,
    sourceId: source.id,
    taskId,
  });
}
