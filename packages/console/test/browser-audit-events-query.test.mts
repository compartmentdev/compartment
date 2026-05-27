import { describe, expect, it } from 'vitest';
import {
  buildAuditEventsHref,
  readNextAuditEventsSortDirection,
} from '../src/features/audit-events/audit-events-query';
import type { BrowserAuditEventsPageResult } from '../src/services/browser-audit-events.service.types';

describe('browser audit events hrefs', (): void => {
  it('omits default paging and sorting params while preserving active filters', (): void => {
    expect(
      buildAuditEventsHref(createAuditEventsPageResult(), {
        actor: 'admin@example.com',
      }),
    ).toBe('/orgs/acme-dev/audit?actor=admin%40example.com');
  });

  it('includes non-default sort and pagination params in pager hrefs', (): void => {
    expect(
      buildAuditEventsHref(createAuditEventsPageResult(), {
        page: 3,
        pageSize: 20,
        sortBy: 'status',
        sortDirection: 'asc',
      }),
    ).toBe('/orgs/acme-dev/audit?sortBy=status&sortDirection=asc&page=3&pageSize=20');
  });

  it('uses occurredAt desc as the default next-sort baseline and asc for other columns', (): void => {
    const data: BrowserAuditEventsPageResult = createAuditEventsPageResult();

    expect(readNextAuditEventsSortDirection(data, 'occurredAt')).toBe('asc');
    expect(readNextAuditEventsSortDirection(data, 'status')).toBe('asc');
  });
});

function createAuditEventsPageResult(): BrowserAuditEventsPageResult {
  return {
    currentOrganizationPermissions: ['organization.audit.read'],
    events: [],
    filters: {
      actor: '',
      eventType: '',
      from: '',
      project: '',
      targetType: '',
      to: '',
    },
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
    sortBy: 'occurredAt',
    sortDirection: 'desc',
    totalEvents: 0,
    totalPages: 1,
  };
}
