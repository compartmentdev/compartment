import { describe, expect, test } from 'vitest';

import { isConsolePathname } from './e2e/support/console-paths';

describe('isConsolePathname', (): void => {
  test('matches bare console paths', (): void => {
    expect(isConsolePathname(new URL('http://console.localhost/projects'), '/projects')).toBe(true);
  });

  test('matches organization-scoped console paths', (): void => {
    expect(isConsolePathname(new URL('http://console.localhost/orgs/acme-dev/projects?q=billing'), '/projects')).toBe(
      true,
    );
    expect(
      isConsolePathname(
        new URL('http://console.localhost/orgs/acme-dev/projects/billing/deployments'),
        '/projects/billing/deployments',
      ),
    ).toBe(true);
  });

  test('does not treat an organization root as a console path', (): void => {
    expect(isConsolePathname(new URL('http://console.localhost/orgs/acme-dev'), '/')).toBe(false);
  });
});
