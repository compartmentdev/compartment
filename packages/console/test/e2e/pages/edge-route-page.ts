import { expect, type Locator, type Page } from '@playwright/test';
import type { ConsoleE2eProxyRouteFixture } from '../support/console-e2e-fixture';

export class EdgeRoutePage {
  private readonly backofficeServiceResponse: Locator;
  private readonly backofficeStatusResponse: Locator;
  private readonly page: Page;
  private readonly publicWebHeading: Locator;

  constructor(page: Page) {
    this.backofficeServiceResponse = page.getByText('"service":"backoffice"');
    this.backofficeStatusResponse = page.getByText('"status":"ok"');
    this.page = page;
    this.publicWebHeading = page.getByRole('heading', { name: 'Multi Service Web' });
  }

  async gotoPublicRoute(proxyRoute: ConsoleE2eProxyRouteFixture): Promise<void> {
    await this.page.goto(proxyRoute.routeUrl);
  }

  async expectPublicRouteVisible(): Promise<void> {
    await expect(this.publicWebHeading).toBeVisible();
  }

  async gotoProxyRoute(proxyRoute: ConsoleE2eProxyRouteFixture): Promise<void> {
    await this.page.goto(this.buildProxyRouteUrl(proxyRoute));
  }

  async expectLoginRedirectForProxyRoute(proxyRoute: ConsoleE2eProxyRouteFixture): Promise<void> {
    await expect(this.page).toHaveURL(/\/login\?/u);

    const loginUrl: URL = new URL(this.page.url());
    const routeUrl: URL = new URL(proxyRoute.routeUrl);

    expect(loginUrl.searchParams.get('host')).toBe(routeUrl.hostname);
    expect(loginUrl.searchParams.get('path')).toBe(proxyRoute.proxyPath);
  }

  getAuthenticatedTargetLocator(): Locator {
    return this.backofficeServiceResponse;
  }

  buildProxyRouteUrl(proxyRoute: ConsoleE2eProxyRouteFixture): string {
    return new URL(proxyRoute.proxyPath, proxyRoute.routeUrl).toString();
  }

  async expectAuthenticatedTargetVisible(proxyRoute: ConsoleE2eProxyRouteFixture): Promise<void> {
    await expect(this.page).toHaveURL(this.buildProxyRouteUrl(proxyRoute));
    await expect(this.backofficeServiceResponse).toBeVisible();
    await expect(this.backofficeStatusResponse).toBeVisible();
  }
}
