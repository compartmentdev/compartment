import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingMethodSelector } from '../src/features/onboarding/onboarding-method-selector';

describe('browser onboarding method selector', (): void => {
  it('describes the Git workflow without naming a provider', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(OnboardingMethodSelector, {
        method: undefined,
        onSelect: (): void => undefined,
      }),
    );

    expect(markup).toContain('Connect a Git provider, pick a repository, then deploy from pushes.');
    expect(markup).not.toContain('Connect GitHub');
  });
});
