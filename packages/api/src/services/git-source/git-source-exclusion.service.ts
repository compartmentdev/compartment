import { createId } from '../../lib/tokens';
import {
  deleteSourceExcludedDescriptorByPath,
  upsertSourceExcludedDescriptor,
} from '../../queries/source-exclusion.query';
import { cancelNonTerminalSourceResolutionTasksByBinding } from '../../queries/source-resolution.query';
import {
  disconnectSourceBindingById,
  findActiveBindingByDescriptorPathWithExecutor,
  findActiveBindingByProjectIdWithExecutor,
  lockSourceMutationWithExecutor,
} from '../../queries/source.query';
import type { SourceBindingRow, SourceMutationTransaction } from '../../queries/source.query.types';

const sourceBindingExcludedFailureReason: string = 'Git source binding was excluded from source sync.';

export async function excludeGitSourceDescriptorWithinTransaction(
  transaction: SourceMutationTransaction,
  sourceId: string,
  descriptorPath: string,
  actorPrincipalId: string,
  now: Date,
): Promise<void> {
  await lockSourceMutationWithExecutor(transaction, sourceId);
  const binding: SourceBindingRow | undefined = await findActiveBindingByDescriptorPathWithExecutor(
    transaction,
    sourceId,
    descriptorPath,
  );
  if (binding === undefined) {
    await createSourceExclusion(transaction, sourceId, descriptorPath, actorPrincipalId, now);
    return;
  }

  await excludeActiveGitSourceBinding(transaction, binding, actorPrincipalId, now);
}

export async function excludeGitSourceProjectBindingWithinTransaction(
  transaction: SourceMutationTransaction,
  projectId: string,
  actorPrincipalId: string,
  now: Date,
): Promise<void> {
  const binding: SourceBindingRow | undefined = await findActiveBindingByProjectIdWithExecutor(transaction, projectId);
  if (binding === undefined) {
    return;
  }

  await lockSourceMutationWithExecutor(transaction, binding.sourceId);
  const lockedBinding: SourceBindingRow | undefined = await findActiveBindingByProjectIdWithExecutor(
    transaction,
    projectId,
  );
  if (lockedBinding === undefined) {
    return;
  }

  await excludeActiveGitSourceBinding(transaction, lockedBinding, actorPrincipalId, now);
}

export async function includeGitSourceDescriptorWithinTransaction(
  transaction: SourceMutationTransaction,
  sourceId: string,
  descriptorPath: string,
): Promise<void> {
  await deleteSourceExcludedDescriptorByPath(transaction, sourceId, descriptorPath);
}

async function excludeActiveGitSourceBinding(
  transaction: SourceMutationTransaction,
  binding: SourceBindingRow,
  actorPrincipalId: string,
  now: Date,
): Promise<void> {
  await createSourceExclusion(transaction, binding.sourceId, binding.descriptorPath, actorPrincipalId, now);
  await disconnectSourceBindingById(transaction, binding.id, now);
  await cancelNonTerminalSourceResolutionTasksByBinding(transaction, {
    completedAt: now,
    failureReason: sourceBindingExcludedFailureReason,
    sourceBindingId: binding.id,
    updatedAt: now,
  });
}

async function createSourceExclusion(
  transaction: SourceMutationTransaction,
  sourceId: string,
  descriptorPath: string,
  actorPrincipalId: string,
  now: Date,
): Promise<void> {
  await upsertSourceExcludedDescriptor(transaction, {
    createdByPrincipalId: actorPrincipalId,
    descriptorPath,
    id: createId('sxe'),
    sourceId,
    updatedAt: now,
  });
}
