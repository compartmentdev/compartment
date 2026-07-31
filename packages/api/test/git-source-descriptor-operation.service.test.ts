import { describe, expect, it, vi } from 'vitest';
import { throwGitDescriptorAccessFailure } from '../src/services/git-source/git-source-descriptor-operation.service';
import { gitlabProviderAdapter } from '../src/services/git-source/gitlab-provider.adapter';

describe('git source descriptor operation failures', (): void => {
  it('maps GitLab authentication failures to the stable invalid-token error', (): void => {
    const error: Error = new Error('unauthorized');
    vi.spyOn(gitlabProviderAdapter, 'isAuthenticationFailure').mockReturnValue(true);
    vi.spyOn(gitlabProviderAdapter, 'isRepositoryAccessFailure').mockReturnValue(false);
    vi.spyOn(gitlabProviderAdapter, 'isRepositoryEmptyFailure').mockReturnValue(false);

    let thrown: Error | undefined;
    try {
      throwGitDescriptorAccessFailure(gitlabProviderAdapter, error, 'operation failed');
    } catch (caught) {
      if (caught instanceof Error) thrown = caught;
    }
    expect(thrown).toMatchObject({ code: 'gitlab_token_invalid' });
  });
});
