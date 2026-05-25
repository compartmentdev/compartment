import { describe, expect, it } from 'vitest';

import { findOrganizationBySlug, type OrganizationSummary } from '../src';

describe('organization helpers', (): void => {
  it('finds an organization by slug only', (): void => {
    const organizations: OrganizationSummary[] = [
      {
        id: 'org_1',
        name: 'Core',
        slug: 'core',
      },
      {
        id: 'org_2',
        name: 'Finance',
        slug: 'finance',
      },
    ];

    expect(findOrganizationBySlug(organizations, 'finance')?.id).toBe('org_2');
    expect(findOrganizationBySlug(organizations, 'org_2')).toBeNull();
    expect(findOrganizationBySlug(organizations, 'Finance')).toBeNull();
  });
});
