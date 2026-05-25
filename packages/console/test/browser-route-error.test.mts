import { describe, expect, it } from 'vitest';
import { browserProjectsPathname, browserUsersPathname } from '../src/browser-public-paths';
import {
  createBrowserRouteErrorViewModel,
  type BrowserRouteErrorViewModel,
} from '../src/features/console/browser-route-error';
import { BrowserApiError } from '../src/lib/browser-api';

describe('browser route error view model', (): void => {
  it('uses product-owned production messaging for forbidden browser route failures', (): void => {
    const viewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(
      new BrowserApiError(403, 'Organization admin access is required.'),
      false,
      '/orgs/acme-dev/users',
    );

    expect(viewModel).toMatchObject({
      message: 'You do not have permission to open this browser console page.',
      primaryActionHref: '/orgs/acme-dev/projects',
      primaryActionLabel: 'Go to projects',
      statusCode: 403,
      title: 'Access denied',
    } satisfies Partial<BrowserRouteErrorViewModel>);
    expect(viewModel.details).toBeUndefined();
  });

  it('classifies not found browser route failures with a product-owned message', (): void => {
    const viewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(
      new BrowserApiError(404, 'Missing browser route.'),
      false,
      '/orgs/acme-dev/users',
    );

    expect(viewModel).toMatchObject({
      message: 'This browser console page is not available.',
      primaryActionHref: '/orgs/acme-dev/projects',
      primaryActionLabel: 'Go to projects',
      statusCode: 404,
      title: 'Page not found',
    } satisfies Partial<BrowserRouteErrorViewModel>);
  });

  it('keeps unexpected route details inside the product UI in development only', (): void => {
    const routeError: Error = new Error('Loader exploded.');
    const developmentViewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(routeError, true);
    const productionViewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(routeError, false);

    expect(developmentViewModel.details).toContain('Loader exploded.');
    expect(productionViewModel.details).toBeUndefined();
  });

  it('sends broken projects route failures to login instead of looping back to projects', (): void => {
    const viewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(
      new BrowserApiError(403, 'Projects route failed.'),
      false,
      browserProjectsPathname,
    );

    expect(viewModel).toMatchObject({
      primaryActionHref: '/login',
      primaryActionLabel: 'Go to login',
    } satisfies Partial<BrowserRouteErrorViewModel>);
  });

  it('does not loop selected-organization projects route failures back to projects', (): void => {
    const viewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(
      new BrowserApiError(403, 'Projects route failed.'),
      false,
      '/orgs/acme-dev/projects',
    );

    expect(viewModel).toMatchObject({
      primaryActionHref: '/login',
      primaryActionLabel: 'Go to login',
    } satisfies Partial<BrowserRouteErrorViewModel>);
  });

  it('sends management route failures without selected organization context to login', (): void => {
    const viewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(
      new BrowserApiError(403, 'Organization admin access is required.'),
      false,
      browserUsersPathname,
    );

    expect(viewModel).toMatchObject({
      primaryActionHref: '/login',
      primaryActionLabel: 'Go to login',
    } satisfies Partial<BrowserRouteErrorViewModel>);
  });

  it('recovers selected-organization project detail failures to scoped projects', (): void => {
    const viewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(
      new BrowserApiError(404, 'Missing project.'),
      false,
      '/orgs/acme-dev/projects/billing',
    );

    expect(viewModel).toMatchObject({
      primaryActionHref: '/orgs/acme-dev/projects',
      primaryActionLabel: 'Go to projects',
    } satisfies Partial<BrowserRouteErrorViewModel>);
  });

  it('recovers malformed organization path failures without throwing', (): void => {
    const viewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(
      new BrowserApiError(404, 'Malformed route.'),
      false,
      '/orgs/%E0%A4%A/projects/billing',
    );

    expect(viewModel).toMatchObject({
      primaryActionHref: '/orgs/%25E0%25A4%25A/projects',
      primaryActionLabel: 'Go to projects',
    } satisfies Partial<BrowserRouteErrorViewModel>);
  });

  it('preserves unexpected HTTP status badges for shared route failures', (): void => {
    const viewModel: BrowserRouteErrorViewModel = createBrowserRouteErrorViewModel(
      new BrowserApiError(500, 'Server exploded.'),
      false,
      '/orgs/acme-dev/users',
    );

    expect(viewModel.statusCode).toBe(500);
  });
});
