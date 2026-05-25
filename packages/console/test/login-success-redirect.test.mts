import type { LoginStateResponse } from '@compartment/contracts/browser';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoginView } from '../src/features/auth/login-view';
import {
  readBrowserLoginSuccessRedirect,
  readLoginSuccessRedirectTo,
} from '../src/features/auth/login-success-redirect';

const externalSuccessRedirectTo: string = 'https://evil.example/orgs/acme-dev/projects/create';

describe('login success redirects', (): void => {
  it('rejects external browser login success redirects', (): void => {
    expect(readBrowserLoginSuccessRedirect(externalSuccessRedirectTo)).toBeUndefined();
    expect(readBrowserLoginSuccessRedirect('//evil.example/projects/create')).toBeUndefined();
  });

  it('preserves relative organization-scoped browser login success redirects', (): void => {
    expect(readBrowserLoginSuccessRedirect('/orgs/acme-dev/projects/create?method=cli#x')).toBe(
      '/orgs/acme-dev/projects/create?method=cli#x',
    );
  });

  it('returns normalized relative browser login success redirects', (): void => {
    expect(readBrowserLoginSuccessRedirect('/orgs/acme-dev/onboarding/../projects/create?method=cli#x')).toBe(
      '/orgs/acme-dev/projects/create?method=cli#x',
    );
  });

  it('falls back to post-login redirects when success redirects are external', (): void => {
    expect(readLoginSuccessRedirectTo('/orgs/acme-dev/projects', externalSuccessRedirectTo)).toBe(
      '/orgs/acme-dev/projects',
    );
  });

  it('does not add external login success redirects to SSO login links', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(LoginView, {
        initialData: {
          flowTarget: null,
          localPasswordEnabled: false,
          ssoOptions: [
            {
              buttonText: 'Continue with SSO',
              loginUrl: '/login/sso?provider=sop_123',
              providerId: 'sop_123',
            },
          ],
          view: 'methods',
        } satisfies LoginStateResponse,
        successRedirectTo: externalSuccessRedirectTo,
      }),
    );

    expect(markup).toContain('href="/login/sso?provider=sop_123"');
    expect(markup).not.toContain('successRedirectTo');
    expect(markup).not.toContain('evil.example');
  });
});
