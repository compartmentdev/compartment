import { test, type ConsoleFixtures } from '../fixtures/console-test';

test.describe('edge route authorization real app', (): void => {
  test('requires login before a public route proxies to an authenticated target service', async ({
    edgeRoutePage,
    e2eProxyRoute,
    loginPage,
  }: ConsoleFixtures): Promise<void> => {
    await edgeRoutePage.gotoPublicRoute(e2eProxyRoute);
    await edgeRoutePage.expectPublicRouteVisible();

    await edgeRoutePage.gotoProxyRoute(e2eProxyRoute);
    await edgeRoutePage.expectLoginRedirectForProxyRoute(e2eProxyRoute);

    await loginPage.loginAndFollowAppRedirect(
      edgeRoutePage.buildProxyRouteUrl(e2eProxyRoute),
      edgeRoutePage.getAuthenticatedTargetLocator(),
    );
    await edgeRoutePage.expectAuthenticatedTargetVisible(e2eProxyRoute);
  });
});
