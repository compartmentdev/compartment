import { describe, expect, it } from 'vitest';
import { buildRolesPageHref, readRolesBackLink } from '../src/features/roles/roles-page.query';

describe('browser roles hrefs', (): void => {
  it('preserves return targets across roles page navigation', (): void => {
    expect(
      buildRolesPageHref(
        {
          backHref: '/orgs/acme-dev/users?page=2',
          selectedOrganizationSlug: 'acme-dev',
        },
        {
          mode: 'edit',
          roleId: 'role_123',
        },
      ),
    ).toBe('/orgs/acme-dev/roles?mode=edit&roleId=role_123&returnTo=%2Forgs%2Facme-dev%2Fusers%3Fpage%3D2');
  });

  it('derives users and groups back links from validated return targets', (): void => {
    expect(readRolesBackLink('/orgs/acme-dev/users?userEmail=viewer%40example.com', 'acme-dev')).toEqual({
      href: '/orgs/acme-dev/users?userEmail=viewer%40example.com',
      label: 'Back to Users',
    });
    expect(readRolesBackLink('/orgs/acme-dev/groups?groupId=group_123', 'acme-dev')).toEqual({
      href: '/orgs/acme-dev/groups?groupId=group_123',
      label: 'Back to Groups',
    });
  });

  it('rejects invalid return targets', (): void => {
    expect(readRolesBackLink('/orgs/acme-dev/projects', 'acme-dev')).toBeNull();
    expect(readRolesBackLink('https://example.com/orgs/acme-dev/users', 'acme-dev')).toBeNull();
  });
});
