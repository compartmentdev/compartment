import { describe, expect, it } from 'vitest';
import { buildGitHubApiBaseUrl } from '../src';

describe('buildGitHubApiBaseUrl', (): void => {
  it('returns the public GitHub API origin for github.com', (): void => {
    expect(buildGitHubApiBaseUrl('github.com')).toBe('https://api.github.com');
  });

  it('returns the GitHub Enterprise API origin for custom hosts', (): void => {
    expect(buildGitHubApiBaseUrl('git.example.com')).toBe('https://git.example.com/api/v3');
  });
});
