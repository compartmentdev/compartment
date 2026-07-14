import { describe, expect, it, vi } from 'vitest';
import { throwGitDescriptorAccessFailure } from '../src/services/git-source/git-source-descriptor-operation.service';
import type { GitProviderAdapter } from '../src/services/git-source/git-source-provider.types';
import { githubProviderAdapter } from '../src/services/git-source/github-provider.adapter';
import { gitlabProviderAdapter } from '../src/services/git-source/gitlab-provider.adapter';

type TestProviderErrorKind = 'access' | 'auth' | 'empty-repo' | 'not-found' | 'rate-limited' | 'unknown';

interface ErrorMappingCase {
  code: string;
  kind: TestProviderErrorKind;
}

interface CodedError extends Error {
  code: string;
}

describe('git source descriptor operation failures', (): void => {
  it('maps GitLab authentication failures to a token-invalid error', (): void => {
    const error: Error = new Error('unauthorized');
    vi.spyOn(gitlabProviderAdapter, 'classifyError').mockReturnValue({ kind: 'auth' });

    let thrown: Error | undefined;
    try {
      throwGitDescriptorAccessFailure(gitlabProviderAdapter, error, 'operation failed');
    } catch (caught) {
      if (caught instanceof Error) thrown = caught;
    }
    expect(thrown).toMatchObject({ code: 'gitlab_token_invalid' });
  });

  it('maps GitHub authentication failures to a reconnectable registration error', (): void => {
    vi.spyOn(githubProviderAdapter, 'classifyError').mockReturnValue({ kind: 'auth' });

    expect(readThrownCode('auth', githubProviderAdapter)).toBe('git_source_registration_failed');
  });

  it.each<ErrorMappingCase>([
    { code: 'git_source_repository_access_denied', kind: 'access' },
    { code: 'git_source_repository_access_denied', kind: 'not-found' },
    { code: 'git_source_repository_empty', kind: 'empty-repo' },
    { code: 'git_source_request_invalid', kind: 'rate-limited' },
  ])('maps neutral $kind failures to business errors', ({ code, kind }: ErrorMappingCase): void => {
    vi.spyOn(gitlabProviderAdapter, 'classifyError').mockReturnValue({ kind });

    expect(readThrownCode(kind, gitlabProviderAdapter)).toBe(code);
  });
});

function readThrownCode(kind: TestProviderErrorKind, adapter: GitProviderAdapter): string | undefined {
  try {
    throwGitDescriptorAccessFailure(adapter, new Error(kind), 'operation failed');
  } catch (error) {
    return error instanceof Error && 'code' in error ? (error as CodedError).code : undefined;
  }
}
