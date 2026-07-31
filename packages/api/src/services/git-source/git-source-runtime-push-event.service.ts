import { createId } from '../../lib/tokens';
import { createOrGetSourceEvent, updateSourceEventStatus } from '../../queries/source-resolution.query';
import type {
  CreateOrGetSourceEventResult,
  SourceEventRow,
  SourceResolutionMutationTransaction,
} from '../../queries/source-resolution.query.types';
import type { ProviderPushDeliveryInput, PushChangedFilesState } from './git-source-runtime.service.types';

export async function createSourcePushEventIfMissing(
  transaction: SourceResolutionMutationTransaction,
  input: ProviderPushDeliveryInput,
  sourceId: string,
  branchName: string,
  commitSha: string,
  payloadJson: string,
  changedFilesState: PushChangedFilesState,
): Promise<SourceEventRow | null> {
  const eventResult: CreateOrGetSourceEventResult = await createOrGetSourceEvent(transaction, {
    branchName,
    changedFilesComplete: changedFilesState.changedFilesComplete,
    changedFilesJson: JSON.stringify(changedFilesState.changedFiles),
    commitSha,
    eventType: 'push',
    id: createId('sev'),
    payloadJson,
    providerDeliveryId: input.providerDeliveryId,
    sourceId,
    status: 'received',
    updatedAt: new Date(),
  });

  return eventResult.created ? eventResult.event : null;
}

export async function updateSourcePushEventCompletion(
  transaction: SourceResolutionMutationTransaction,
  sourceEventId: string,
  createdTaskCount: number,
): Promise<void> {
  const now: Date = new Date();
  await updateSourceEventStatus(transaction, {
    completedAt: createdTaskCount > 0 ? null : now,
    sourceEventId,
    status: createdTaskCount > 0 ? 'tasks_created' : 'completed',
    updatedAt: now,
  });
}
