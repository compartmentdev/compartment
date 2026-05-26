import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GitAccountPicker } from '../src/features/onboarding/onboarding-git-account-picker';

describe('browser onboarding Git account picker', (): void => {
  it('renders truthful actions for installed and uninstalled accounts', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(GitAccountPicker, {
        accounts: [
          {
            appInstallationStatus: 'installed',
            avatarUrl: null,
            login: 'acme',
            type: 'organization',
          },
          {
            appInstallationStatus: 'not_installed',
            avatarUrl: null,
            login: 'admin',
            type: 'user',
          },
        ],
        installError: false,
        installingAccountLogin: null,
        onAccountSelected: (): void => undefined,
        status: 'ready',
      }),
    );

    expect(markup).toContain('Choose GitHub account');
    expect(markup).toContain('If Compartment is already installed for that account');
    expect(markup).toContain('Open repositories');
    expect(markup).toContain('Install app');
  });

  it('uses a non-install loading label for installed accounts', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(GitAccountPicker, {
        accounts: [
          {
            appInstallationStatus: 'installed',
            avatarUrl: null,
            login: 'acme',
            type: 'organization',
          },
        ],
        installError: false,
        installingAccountLogin: 'acme',
        onAccountSelected: (): void => undefined,
        status: 'ready',
      }),
    );

    expect(markup).toContain('Continuing');
    expect(markup).not.toContain('Opening GitHub');
  });
});
