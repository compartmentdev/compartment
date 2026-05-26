import * as React from 'react';
import type { AuditEventSummary } from '@compartment/contracts/browser';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LoaderFunctionArgs } from 'react-router';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  BrowserAuditEventFilters,
  BrowserAuditEventsPageResult,
} from '../src/services/browser-audit-events.service.types';
import type { BrowserConsoleOrganizationContext } from '../src/services/browser-organization-context.service.types';
import { AuditEventsTable } from '../src/features/audit-events/audit-events-table';
import { AuditEventsView } from '../src/features/audit-events/audit-events-view';
import { loadAuditEventsPageData } from '../src/features/audit-events/audit-events-loader';
import { browserQueryClient } from '../src/lib/browser-query-client';
import {
  createOrganizationListResponse,
  createProjectCountResponse,
  createWhoamiResponse,
  readFetchPath,
  type BrowserFetchCall,
  type FetchImplementation,
} from './browser-client-pages.helpers';
import { createJsonResponse } from './browser-test.fixtures';

const browserProjectCountPath: string =
  '/v1/projects?archiveState=active&detail=overview&orderBy=updatedAt&page=1&perPage=1&sort=desc';

interface CreateAuditEventsPageResultOptions {
  filters?: Partial<BrowserAuditEventFilters>;
  organizationContext?: BrowserConsoleOrganizationContext;
  selectedOrganizationSlug?: string | null;
}

describe('browser audit events page', (): void => {
  afterEach((): void => {
    browserQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it('loads audit events through the organization-scoped audit API filters', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        await Promise.resolve();
        const path: string = readFetchPath(input);
        if (path === '/v1/orgs') {
          return createJsonResponse(createOrganizationListResponse());
        }
        if (path === '/v1/whoami') {
          return createJsonResponse(createWhoamiResponse(['organization.audit.read']));
        }
        if (path === browserProjectCountPath) {
          return createJsonResponse(createProjectCountResponse());
        }
        if (path.startsWith('/v1/audit/events?')) {
          return createJsonResponse({
            events: [createAuditEvent()],
            pagination: {
              page: 2,
              perPage: 20,
              totalItems: 24,
              totalPages: 2,
            },
          });
        }

        throw new Error(`Unexpected fetch path: ${path}`);
      });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    const result: BrowserAuditEventsPageResult = await loadAuditEventsPageData(
      createAuditEventsLoaderArgs(
        'http://console.localhost/orgs/acme-dev/audit?from=2026-05-14T10%3A00&to=2026-05-14T12%3A30&eventType=organization.user.invited&actor=admin%40example.com&targetType=user&project=prj_123&page=2&pageSize=20',
      ),
    );
    const auditRequestPath: string = readAuditRequestPath(fetchMock.mock.calls);
    const auditRequestUrl: URL = new URL(auditRequestPath, 'http://console.localhost');

    expect(result.totalEvents).toBe(24);
    expect(auditRequestUrl.pathname).toBe('/v1/audit/events');
    expect(Object.fromEntries(auditRequestUrl.searchParams)).toEqual({
      actor: 'admin@example.com',
      eventType: 'organization.user.invited',
      from: new Date('2026-05-14T10:00').toISOString(),
      page: '2',
      perPage: '20',
      project: 'prj_123',
      targetType: 'user',
      to: new Date('2026-05-14T12:30').toISOString(),
    });
  });

  it('renders audit event identity, actor, target, status, and metadata', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(AuditEventsTable, {
        data: createAuditEventsPageResult(),
      }),
    );

    expect(html).toContain('Organization user invited');
    expect(html).toContain('min-w-[10.5rem]');
    expect(html).not.toContain('organization.user.invited');
    expect(html).toContain('admin@example.com');
    expect(html).toContain('viewer@example.com');
    expect(html).toContain('Succeeded');
    expect(html).toContain('inviteEmail');
  });

  it('keeps the audit header ahead of organization recovery content', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(AuditEventsView, {
        data: createAuditEventsPageResult({
          organizationContext: {
            kind: 'organization_required',
            requestedOrganizationSlug: null,
            selectedOrganizationSlug: null,
          },
          selectedOrganizationSlug: null,
        }),
        onNavigate: vi.fn(),
      }),
    );

    expect(html).toContain('Audit logs</h1>');
    expect(html).toContain('Choose an organization');
    expect(html.indexOf('Audit logs')).toBeLessThan(html.indexOf('Choose an organization'));
  });

  it('renders the target filter as a curated audit target control', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(
      React.createElement(AuditEventsView, {
        data: createAuditEventsPageResult({ filters: { targetType: 'source_binding' } }),
        onNavigate: vi.fn(),
      }),
    );

    expect(html).toContain('name="targetType"');
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('role, user, source');
  });
});

function readAuditRequestPath(calls: BrowserFetchCall[]): string {
  const path: string | undefined = calls
    .map((call: BrowserFetchCall): string => readFetchPath(call[0]))
    .find((value: string): boolean => value.startsWith('/v1/audit/events?'));
  if (path === undefined) {
    throw new Error('Expected audit events request.');
  }

  return path;
}

function createAuditEventsLoaderArgs(url: string): LoaderFunctionArgs {
  return {
    context: undefined,
    params: {},
    request: new Request(url),
    unstable_pattern: '/audit',
    unstable_url: new URL(url),
  };
}

function createAuditEventsPageResult(options: CreateAuditEventsPageResultOptions = {}): BrowserAuditEventsPageResult {
  return {
    currentOrganizationPermissions: ['organization.audit.read'],
    events: [createAuditEvent()],
    filters: {
      actor: '',
      eventType: '',
      from: '',
      project: '',
      targetType: '',
      to: '',
      ...options.filters,
    },
    organizationContext: options.organizationContext ?? { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ],
    page: 1,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50],
    principalEmail: 'admin@example.com',
    projectCount: 1,
    selectedOrganizationSlug: options.selectedOrganizationSlug ?? 'acme-dev',
    showOrganizationSelector: false,
    totalEvents: 1,
    totalPages: 1,
  };
}

function createAuditEvent(): AuditEventSummary {
  return {
    actor: {
      email: 'admin@example.com',
      principalId: 'prn_123',
      sessionId: 'ses_123',
      sourceIp: '127.0.0.1',
      transport: 'cookie',
      type: 'user',
      userAgent: 'vitest',
    },
    eventType: 'organization.user.invited',
    id: 'aud_123',
    metadata: {
      inviteEmail: 'viewer@example.com',
    },
    occurredAt: '2026-05-14T10:00:00.000Z',
    organizationId: 'org_123',
    scopeType: 'organization',
    status: 'succeeded',
    target: {
      displayName: 'viewer@example.com',
      environmentId: null,
      id: 'usr_123',
      projectId: null,
      serviceId: null,
      type: 'user',
    },
  };
}
