import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { GitLabHttpClient } from '../src/services/git-source/gitlab-http.adapter';
import type { GitLabRequestInput } from '../src/services/git-source/gitlab-http.adapter.types';
import {
  ensureGitLabProjectHook,
  removeGitLabProjectHooks,
} from '../src/services/git-source/gitlab-project-hook.adapter';

type GitLabRequest = <T>(input: GitLabRequestInput) => Promise<T>;
type GitLabRequestPages = <T>(input: GitLabRequestInput, pageCap: number) => Promise<T[]>;

describe('GitLab project hook lifecycle', (): void => {
  it('recovers a hook id when create succeeds remotely but the response times out', async (): Promise<void> => {
    const client: GitLabHttpClient = createClient();
    vi.spyOn(client, 'requestPages')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 17, url: webhookUrl }])
      .mockResolvedValueOnce([{ id: 17, url: webhookUrl }]);
    vi.spyOn(client, 'request').mockRejectedValueOnce(new Error('request timed out'));

    await expect(ensureGitLabProjectHook(client, '42', webhookUrl, 'secret', null)).resolves.toBe('17');
  });

  it('surfaces hook deletion failures', async (): Promise<void> => {
    const client: GitLabHttpClient = createClient();
    vi.spyOn(client, 'requestPages').mockResolvedValueOnce([{ id: 17, url: webhookUrl }]);
    vi.spyOn(client, 'request').mockRejectedValueOnce(new Error('delete failed'));

    await expect(removeGitLabProjectHooks(client, '42', webhookUrl, '17')).rejects.toThrow('delete failed');
  });

  it('reconciles hooks created by concurrent connects to one canonical id', async (): Promise<void> => {
    const client: GitLabHttpClient = createClient();
    const requestPages: MockInstance<GitLabRequestPages> = vi.spyOn(client, 'requestPages');
    requestPages
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: 2, url: webhookUrl },
        { id: 1, url: webhookUrl },
      ]);
    let createCount: number = 0;
    let releaseCreates: (() => void) | undefined;
    const bothCreatesStarted: Promise<void> = new Promise<void>((resolve: () => void): void => {
      releaseCreates = resolve;
    });
    const request: MockInstance<GitLabRequest> = vi
      .spyOn(client, 'request')
      .mockImplementation(async <T>(input: GitLabRequestInput): Promise<T> => {
        if (input.method === 'POST') {
          createCount += 1;
          if (createCount === 2) releaseCreates?.();
          await bothCreatesStarted;
          return { id: createCount, url: webhookUrl } as T;
        }
        return undefined as T;
      });

    await expect(
      Promise.all([
        ensureGitLabProjectHook(client, '42', webhookUrl, 'secret', null),
        ensureGitLabProjectHook(client, '42', webhookUrl, 'secret', null),
      ]),
    ).resolves.toEqual(['1', '1']);
    expect(createCount).toBe(2);
    expect(
      request.mock.calls.filter((call: [GitLabRequestInput]): boolean => call[0].method === 'DELETE'),
    ).toHaveLength(2);
  });
});

const webhookUrl: string = 'https://compartment.example/v1/sources/git/providers/gitlab/webhook';

function createClient(): GitLabHttpClient {
  return Object.create(GitLabHttpClient.prototype) as GitLabHttpClient;
}
