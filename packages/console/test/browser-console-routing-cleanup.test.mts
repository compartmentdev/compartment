import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { browserQueryClient } from '../src/lib/browser-query-client';
import { loadOnboardingPage } from '../src/features/onboarding/onboarding-page';
import type { OnboardingPageData } from '../src/features/onboarding/onboarding-page-data.types';
import { loadProjectCreatePage } from '../src/features/onboarding/project-create-page';
import { OnboardingStatus } from '../src/features/onboarding/onboarding-shared';
import { loadProjectsPageData } from '../src/features/projects/projects-loader';
import {
  createLoaderArgs,
  createOrganizationListResponse,
  createWhoamiResponse,
  readFetchPath,
  requireRedirectResponse,
  type BrowserFetchCall,
  type FetchImplementation,
} from './browser-client-pages.helpers';
import { createJsonResponse } from './browser-test.fixtures';

type OnboardingPageLoadResult = OnboardingPageData | Response;

describe('browser console routing cleanup', (): void => {
  afterEach((): void => {
    browserQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it('redirects single-organization bare project routes to the canonical org path', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: Response = requireRedirectResponse(
      await loadProjectsPageData(createLoaderArgs(new Request('http://console.localhost/projects'))),
    );

    expect(result.headers.get('Location')).toBe('/orgs/acme-dev/projects');
    expect(fetchMock.mock.calls.map((call: BrowserFetchCall): string => readFetchPath(call[0]))).toEqual(['/v1/orgs']);
  });

  it('loads onboarding page data with an org-scoped skip href', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: OnboardingPageLoadResult = await loadOnboardingPage(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/onboarding')),
    );

    expect(result).toMatchObject({
      principalEmail: 'admin@example.com',
      projectsHref: '/orgs/acme-dev/projects',
      selectedOrganizationSlug: 'acme-dev',
    });
  });

  it('loads unavailable onboarding organization context with a recovery projects href', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse({
            currentOrganization: null,
            currentOrganizationPermissions: [],
            principal: { email: 'admin@example.com', id: 'prn_123', type: 'user' },
          });
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: OnboardingPageLoadResult = await loadOnboardingPage(
      createLoaderArgs(new Request('http://console.localhost/orgs/hidden-org/onboarding')),
    );

    expect(result).toMatchObject({
      organizationContext: {
        kind: 'organization_unavailable',
        requestedOrganizationSlug: 'hidden-org',
        selectedOrganizationSlug: null,
      },
      projectsHref: '/orgs/hidden-org/projects',
      selectedOrganizationSlug: null,
    });
  });

  it('loads create page data with an org-scoped back-to-projects href', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse());
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: OnboardingPageLoadResult = await loadProjectCreatePage(
      createLoaderArgs(new Request('http://console.localhost/orgs/acme-dev/projects/create')),
    );

    expect(result).toMatchObject({
      principalEmail: 'admin@example.com',
      projectsHref: '/orgs/acme-dev/projects',
      selectedOrganizationSlug: 'acme-dev',
    });
  });

  it('requires organization selection before bare-route onboarding in multi-org sessions', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse({
            organizations: [
              { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
              { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
            ],
          });
        }
        if (path === '/v1/whoami') {
          return createJsonResponse({
            currentOrganization: null,
            currentOrganizationPermissions: [],
            principal: { email: 'admin@example.com', id: 'prn_123', type: 'user' },
          });
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: OnboardingPageLoadResult = await loadOnboardingPage(
      createLoaderArgs(new Request('http://console.localhost/onboarding')),
    );

    expect(result).toMatchObject({
      organizationContext: {
        kind: 'organization_required',
        requestedOrganizationSlug: null,
        selectedOrganizationSlug: null,
      },
      projectsHref: '/',
      selectedOrganizationSlug: null,
    });
  });

  it('requires organization selection before bare-route create in multi-org sessions', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>(
      async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse({
            organizations: [
              { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
              { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
            ],
          });
        }
        if (path === '/v1/whoami') {
          return createJsonResponse({
            currentOrganization: null,
            currentOrganizationPermissions: [],
            principal: { email: 'admin@example.com', id: 'prn_123', type: 'user' },
          });
        }

        throw new Error(`Unexpected browser API request: ${path}`);
      },
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: OnboardingPageLoadResult = await loadProjectCreatePage(
      createLoaderArgs(new Request('http://console.localhost/projects/create')),
    );

    expect(result).toMatchObject({
      organizationContext: {
        kind: 'organization_required',
        requestedOrganizationSlug: null,
        selectedOrganizationSlug: null,
      },
      projectsHref: '/',
      selectedOrganizationSlug: null,
    });
  });

  it('renders an org-scoped open projects action for successful onboarding status', (): void => {
    const html: string = renderToStaticMarkup(
      createElement(OnboardingStatus, {
        label: 'Deployment',
        selectedOrganizationSlug: 'acme-dev',
        showOpenProjectsOnSuccess: true,
        state: 'success',
        value: 'Ready',
      }),
    );

    expect(html).toContain('Open Projects');
    expect(html).toContain('href="/orgs/acme-dev/projects"');
  });
});
