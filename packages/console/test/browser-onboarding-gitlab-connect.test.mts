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
    expect(markup).toContain('Create a personal access token');
    expect(markup).toContain(
      'href="https://gitlab.example.com/-/user_settings/personal_access_tokens?name=Compartment&amp;scopes=api"',
    );
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain('with the api scope. Your account needs Maintainer access to the repository.');
  });
});
