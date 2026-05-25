import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FirstDeployHeader, type FirstDeployHeaderCopy } from '../src/features/onboarding/first-deploy-header';

describe('browser first deploy page', (): void => {
  it('hides breadcrumbs when the flow opts out of them', (): void => {
    const copy: FirstDeployHeaderCopy = {
      description: 'Choose how this runtime should receive application code.',
      eyebrow: 'Compartment is installed',
      secondaryActionLabel: 'Skip',
      title: 'Ship your first app',
    };

    const html: string = renderToStaticMarkup(
      createElement(FirstDeployHeader, {
        copy,
        hideBreadcrumbs: true,
        projectsHref: '/orgs/acme-dev/projects',
      }),
    );

    expect(html).not.toContain('aria-label="Breadcrumb"');
    expect(html).not.toContain('>Projects<');
    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toContain('title="Ship your first app">Ship your first app</span>');
    expect(html).toContain('>Skip<');
  });

  it('renders create project breadcrumbs without description or a secondary action', (): void => {
    const copy: FirstDeployHeaderCopy = {
      description: null,
      eyebrow: null,
      secondaryActionLabel: null,
      title: 'Create project',
    };

    const html: string = renderToStaticMarkup(
      createElement(FirstDeployHeader, {
        copy,
        hideBreadcrumbs: false,
        projectsHref: '/orgs/acme-dev/projects',
      }),
    );

    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/orgs/acme-dev/projects"');
    expect(html).toContain('>Projects<');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('title="Create project">Create project</span>');
    expect(html).not.toContain('Choose how this runtime should receive application code');
    expect(html).not.toContain('>Back to Projects<');
  });
});
