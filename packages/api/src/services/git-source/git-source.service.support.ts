import { createGitSourceNotFoundError } from '../../errors/api-business-error';
import {
  sourceBindingsActiveProjectUniqueConstraintName,
  sourcesActiveRepoUniqueConstraintName,
} from '../../git-source.constants';
import { readConstraintName } from '../../queries/query-error';
import { findConnectedSourceById } from '../../queries/source.query';
import type { SourceRow } from '../../queries/source.query.types';
import type { DisconnectGitSourceInput } from './git-source.service.types';

export async function requireActiveConnectedSource(input: DisconnectGitSourceInput): Promise<SourceRow> {
  const source: SourceRow = await requireConnectedSource(input);
  if (source.status !== 'active') {
    throw createGitSourceNotFoundError();
  }

  return source;
}

export async function requireConnectedSource(input: DisconnectGitSourceInput): Promise<SourceRow> {
  const source: SourceRow | undefined = await findConnectedSourceById(input.organizationId, input.sourceId);
  if (source === undefined || source.status === 'disconnected') {
    throw createGitSourceNotFoundError();
  }

  return source;
}

export function readKnownConnectConflictMessage(
  error: Error | NodeJS.ErrnoException | null | undefined,
): string | undefined {
  const constraintName: string | undefined = readConstraintName(error);
  if (constraintName === sourcesActiveRepoUniqueConstraintName) {
    return 'This repository already has an active Git source binding.';
  }
  if (constraintName === sourceBindingsActiveProjectUniqueConstraintName) {
    return 'One of the selected projects already has an active Git binding.';
  }

  return undefined;
}
