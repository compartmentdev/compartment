import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createGitLabTrustedOutboundFetch } from '../src/services/outbound-http.service';
import { GitLabTokenValidationError, readGitLabTokenIdentity } from '../src/services/git-source/gitlab-user.adapter';

vi.mock('../src/services/outbound-http.service', (): object => ({
  createGitLabTrustedOutboundFetch: vi.fn(),
}));

describe('GitLab token identity', (): void => {
  const fetchMock: Mock = vi.fn();

  beforeEach((): void => {
    fetchMock.mockReset();
    vi.mocked(createGitLabTrustedOutboundFetch).mockReturnValue(fetchMock);
  });

  it('uses the immutable user id and preserves token expiry', async (): Promise<void> => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenInfo()))
      .mockResolvedValueOnce(jsonResponse({ id: 101, username: 'renamed-user' }));

    await expect(readGitLabTokenIdentity('gitlab.com', 'token')).resolves.toEqual({
      expiresAt: new Date('2027-01-02T23:59:59.999Z'),
      userId: '101',
      username: 'renamed-user',
    });
  });

  it('rejects tokens without the api scope before reading the user', async (): Promise<void> => {
    fetchMock.mockResolvedValueOnce(jsonResponse(tokenInfo({ scopes: ['read_api'] })));

    await expect(readGitLabTokenIdentity('gitlab.com', 'token')).rejects.toEqual(
      new GitLabTokenValidationError('The GitLab personal access token must include the api scope.'),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { active: false, revoked: false },
    { active: true, revoked: true },
  ])('rejects inactive token state %#', async (state: TokenState): Promise<void> => {
    fetchMock.mockResolvedValueOnce(jsonResponse(tokenInfo(state)));

    await expect(readGitLabTokenIdentity('gitlab.com', 'token')).rejects.toThrow(/inactive or revoked/u);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

interface TokenInfoOverrides {
  active?: boolean;
  revoked?: boolean;
  scopes?: string[];
}

interface TokenState {
  active: boolean;
  revoked: boolean;
}

function tokenInfo(overrides: TokenInfoOverrides = {}): object {
  return {
    active: overrides.active ?? true,
    expires_at: '2027-01-02',
    revoked: overrides.revoked ?? false,
    scopes: overrides.scopes ?? ['api'],
    user_id: 101,
  };
}

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
