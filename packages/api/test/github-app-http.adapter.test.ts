import { describe, expect, it } from 'vitest';

import {
  isGitHubRepositoryEmptyFailure,
  isGitHubTransportFailure,
} from '../src/services/git-source/github-app-http.adapter';

interface MockGitHubFailureResponse {
  data?: {
    message?: string | undefined;
  };
}

interface MockGitHubFailure extends Error {
  response?: MockGitHubFailureResponse;
  status?: number;
}

describe('github app http adapter', (): void => {
  it('detects empty GitHub repositories from request failures', (): void => {
    expect(
      isGitHubRepositoryEmptyFailure(
        createMockFailure('HttpError', 409, { data: { message: 'Git Repository is empty' } }),
      ),
    ).toBe(true);
  });

  it('does not classify unrelated GitHub 409 failures as empty repositories', (): void => {
    expect(
      isGitHubRepositoryEmptyFailure(createMockFailure('HttpError', 409, { data: { message: 'Repository blocked' } })),
    ).toBe(false);
  });

  it('detects Octokit request errors without an HTTP response as transport failures', (): void => {
    expect(isGitHubTransportFailure(createMockFailure('HttpError', 500))).toBe(true);
  });

  it('does not classify Octokit HTTP responses as transport failures', (): void => {
    expect(isGitHubTransportFailure(createMockFailure('HttpError', 500, { data: {} }))).toBe(false);
  });
});

function createMockFailure(name: string, status?: number, response?: MockGitHubFailureResponse): MockGitHubFailure {
  const error: MockGitHubFailure = Object.assign(new Error(name), { name });

  if (status !== undefined) {
    error.status = status;
  }

  if (response !== undefined) {
    error.response = response;
  }

  return error;
}
