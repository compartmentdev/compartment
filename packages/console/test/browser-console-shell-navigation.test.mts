import type { RouteObject, ShouldRevalidateFunctionArgs } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../src/app-routes';
import {
  browserOrganizationProjectCreatePathnameTemplate,
  browserProjectCreatePathname,
} from '../src/browser-public-paths';
import { browserConsoleShellRouteId } from '../src/features/console/console-shell-route';
import { shouldRevalidateBrowserConsoleShellRoute } from '../src/features/console/console-shell-route.navigation';

interface ShellRevalidationInput {
  currentPath: string;
  defaultShouldRevalidate?: boolean | undefined;
  nextPath: string;
}

describe('browser console shell route navigation', (): void => {
  it('revalidates shell data when the organization slug changes in the path', (): void => {
    expect(
      shouldRevalidateBrowserConsoleShellRoute(
        createShellRevalidationArgs({
          currentPath: '/orgs/acme-dev/projects',
          defaultShouldRevalidate: false,
          nextPath: '/orgs/beta-dev/projects',
        }),
      ),
    ).toBe(true);
  });

  it('keeps role drawer close navigation on the current organization shell data', (): void => {
    expect(
      shouldRevalidateBrowserConsoleShellRoute(
        createShellRevalidationArgs({
          currentPath: '/orgs/acme-dev/roles?mode=edit&roleId=rol_123',
          nextPath: '/orgs/acme-dev/roles',
        }),
      ),
    ).toBe(false);
  });

  it('keeps the org-scoped create project route inside the console shell', (): void => {
    const rootRoute: RouteObject | undefined = appRoutes[0];
    const rootChildren: RouteObject[] = rootRoute?.children ?? [];
    const shellRoute: RouteObject | undefined = rootChildren.find(
      (route: RouteObject): boolean => route.id === browserConsoleShellRouteId,
    );

    expect(
      shellRoute?.children?.some(
        (route: RouteObject): boolean => route.path === browserOrganizationProjectCreatePathnameTemplate,
      ),
    ).toBe(true);
    expect(
      rootChildren.some(
        (route: RouteObject): boolean => route.path === browserOrganizationProjectCreatePathnameTemplate,
      ),
    ).toBe(false);
    expect(rootChildren.some((route: RouteObject): boolean => route.path === browserProjectCreatePathname)).toBe(true);
  });
});

function createShellRevalidationArgs(input: ShellRevalidationInput): ShouldRevalidateFunctionArgs {
  return {
    currentParams: {},
    currentUrl: new URL(input.currentPath, 'http://console.localhost'),
    defaultShouldRevalidate: input.defaultShouldRevalidate ?? true,
    nextParams: {},
    nextUrl: new URL(input.nextPath, 'http://console.localhost'),
  };
}
