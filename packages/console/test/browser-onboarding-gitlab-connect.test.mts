import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GitLabConnect } from '../src/features/onboarding/onboarding-gitlab-connect';

vi.mock('../src/features/onboarding/onboarding-git-api', (): object => ({
  createBrowserGitLabProviderRegistration: vi.fn(),
}));

describe('browser onboarding GitLab connection', (): void => {
  it('renders the self-managed host and token form', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(GitLabConnect, {
        initialProviderHost: 'gitlab.example.com',
        navigate: (): void => undefined,
        selectedOrganizationSlug: 'acme-dev',
      }),
    );

    expect(markup).toContain('Connect GitLab');
    expect(markup).toContain('GitLab host');
    expect(markup).toContain('value="gitlab.example.com"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('api scope and Maintainer access');
  });
});
