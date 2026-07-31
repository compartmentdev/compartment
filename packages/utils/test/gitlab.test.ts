import { describe, expect, it } from 'vitest';
import { buildGitLabApiBaseUrl } from '../src';

describe('buildGitLabApiBaseUrl', (): void => {
  it('returns the GitLab API origin for gitlab.com', (): void => {
    expect(buildGitLabApiBaseUrl('gitlab.com')).toBe('https://gitlab.com/api/v4');
  });

  it('returns the API origin for self-managed hosts', (): void => {
    expect(buildGitLabApiBaseUrl('gitlab.example.com')).toBe('https://gitlab.example.com/api/v4');
  });
});
