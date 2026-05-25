import { createGitSourceConflictError, createGitSourceNotFoundError } from '../../errors/api-business-error';
import { findConnectedSourceById } from '../../queries/source.query';
import type { SourceRow } from '../../queries/source.query.types';
import type { GitSourceSyncContextInput } from './git-source-sync.service.types';

export async function requireActiveConnectedGitSourceForSync(input: GitSourceSyncContextInput): Promise<SourceRow> {
  return requireActiveGitSourceForSync(await requireConnectedGitSourceForSync(input));
}

function requireActiveGitSourceForSync(source: SourceRow): SourceRow {
  if (source.status === 'active') {
    return source;
  }

  throw createGitSourceConflictError('Disabled Git sources cannot sync until reconnect.');
}

async function requireConnectedGitSourceForSync(input: GitSourceSyncContextInput): Promise<SourceRow> {
  return requireExistingGitSourceForSync(await findConnectedSourceById(input.organizationId, input.sourceId));
}

function requireExistingGitSourceForSync(source: SourceRow | undefined): SourceRow {
  if (source === undefined) {
    throw createGitSourceNotFoundError();
  }

  return source;
}
