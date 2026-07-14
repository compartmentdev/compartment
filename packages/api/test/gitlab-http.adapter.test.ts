import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  encodeGitLabProjectPath,
  GitLabHttpClient,
  GitLabPaginationLimitError,
  isGitLabAuthenticationFailure,
} from '../src/services/git-source/gitlab-http.adapter';
import { createGitLabTrustedOutboundFetch } from '../src/services/outbound-http.service';

vi.mock('../src/services/outbound-http.service', (): object => ({
  createGitLabTrustedOutboundFetch: vi.fn(),
}));

describe('GitLab HTTP adapter', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it('encodes subgroup project paths as one opaque identifier', (): void => {
    expect(encodeGitLabProjectPath('group/subgroup', 'repo')).toBe('group%2Fsubgroup%2Frepo');
  });

  it('follows x-next-page pagination', async (): Promise<void> => {
    const fetchMock: Mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }], '2'))
      .mockResolvedValueOnce(jsonResponse([{ id: 2 }], ''));
    vi.mocked(createGitLabTrustedOutboundFetch).mockReturnValue(fetchMock);
    const client: GitLabHttpClient = new GitLabHttpClient({ providerHost: 'gitlab.com', token: 'token' });
    expect(await client.requestPages<{ id: number }>({ path: '/projects' }, 10)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails when pagination exceeds its safety cap', async (): Promise<void> => {
    vi.mocked(createGitLabTrustedOutboundFetch).mockReturnValue(
      vi.fn().mockResolvedValue(jsonResponse([{ id: 1 }], '2')),
    );
    const client: GitLabHttpClient = new GitLabHttpClient({ providerHost: 'gitlab.com', token: 'token' });
    await expect(client.requestPages({ path: '/projects' }, 1)).rejects.toEqual(
      new GitLabPaginationLimitError('/projects', 1),
    );
  });

  it.each([
    [401, true],
    [403, false],
    [404, false],
  ])(
    'classifies authentication failure for HTTP %i',
    async (status: number, authentication: boolean): Promise<void> => {
      vi.mocked(createGitLabTrustedOutboundFetch).mockReturnValue(
        vi.fn().mockResolvedValue(new Response('', { status })),
      );
      const client: GitLabHttpClient = new GitLabHttpClient({ providerHost: 'gitlab.com', token: 'token' });
      const error: Error = await readRequestError(client);
      expect(isGitLabAuthenticationFailure(error)).toBe(authentication);
    },
  );
});

function jsonResponse(body: object, nextPage: string): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'x-next-page': nextPage },
  });
}

async function readRequestError(client: GitLabHttpClient): Promise<Error> {
  try {
    await client.request({ path: '/user' });
    return new Error('Expected GitLab request to fail.');
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
