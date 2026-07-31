import {
  createGitSourceRepositoryAccessDeniedError,
  createGitSourceRepositoryEmptyError,
  createGitSourceRequestInvalidError,
} from '../../errors/api-business-error';
import type { GitProviderAdapter, GitProviderErrorClassification } from './git-source-provider.types';

export function classifyGitProviderHttpStatus(status: number | null): GitProviderErrorClassification {
  if (status === 401) return { kind: 'auth' };
  if (status === 403) return { kind: 'access' };
  if (status === 404) return { kind: 'not-found' };
  if (status === 429) return { kind: 'rate-limited' };
  return { kind: 'unknown' };
}

export function throwGitProviderBusinessError(
  adapter: GitProviderAdapter,
  error: Error | undefined,
  accessMessage: string,
): never {
  const classification: GitProviderErrorClassification = adapter.classifyError(error);
  if (classification.kind === 'auth') {
    throw adapter.createAuthFailureError();
  }
  if (classification.kind === 'empty-repo') {
    throw createGitSourceRepositoryEmptyError();
  }
  if (classification.kind === 'access' || classification.kind === 'not-found') {
    throw createGitSourceRepositoryAccessDeniedError(accessMessage);
  }
  if (classification.kind === 'rate-limited') {
    throw createGitSourceRequestInvalidError('The git provider rate limit was exceeded. Retry later.');
  }
  if (classification.userMessage !== undefined) {
    throw createGitSourceRequestInvalidError(classification.userMessage);
  }
  throw error ?? new Error('Git provider operation failed.');
}
