import { describe, expect, it } from 'vitest';
import {
  auditEventExportQuerySchema,
  auditEventListQuerySchema,
  auditEventListResponseSchema,
  auditRetentionConfiguredPolicySchema,
  type AuditEventListResponse,
} from '../src';

describe('audit event contracts', (): void => {
  it('accepts audit event list responses', (): void => {
    const response: AuditEventListResponse = auditEventListResponseSchema.parse({
      events: [
        {
          actor: {
            email: 'admin@example.com',
            principalId: 'prn_123',
            sessionId: 'ses_123',
            sourceIp: '127.0.0.1',
            transport: 'bearer',
            type: 'user',
            userAgent: 'compartment-cli',
          },
          eventType: 'organization.role.created',
          id: 'aud_123',
          metadata: {
            kind: 'custom',
            permissionCount: 2,
          },
          occurredAt: '2026-05-12T10:00:00.000Z',
          organizationId: 'org_123',
          scopeType: 'organization',
          status: 'succeeded',
          target: {
            displayName: 'Security',
            environmentId: null,
            id: 'rol_123',
            projectId: null,
            serviceId: null,
            type: 'role',
          },
        },
        {
          actor: {
            email: 'admin@example.com',
            principalId: 'prn_123',
            sessionId: 'ses_123',
            sourceIp: '127.0.0.1',
            transport: 'bearer',
            type: 'user',
            userAgent: 'compartment-cli',
          },
          eventType: 'source.connected',
          id: 'aud_124',
          metadata: {
            defaultBranchName: 'main',
            providerHost: 'github.com',
            repositoryName: 'mono',
            repositoryOwner: 'acme',
          },
          occurredAt: '2026-05-12T10:01:00.000Z',
          organizationId: 'org_123',
          scopeType: 'organization',
          status: 'succeeded',
          target: {
            displayName: 'acme/mono',
            environmentId: null,
            id: 'src_123',
            projectId: null,
            serviceId: null,
            type: 'source',
          },
        },
      ],
      pagination: {
        page: 1,
        perPage: 100,
        totalItems: 2,
        totalPages: 1,
      },
    });

    expect(response.events[0]?.eventType).toBe('organization.role.created');
  });

  it('coerces list pagination and validates export format', (): void => {
    expect(
      auditEventListQuerySchema.parse({
        eventType: 'organization.user.invited',
        from: '2026-05-01T00:00:00.000Z',
        orderBy: 'status',
        page: '2',
        perPage: '25',
        sort: 'asc',
      }),
    ).toMatchObject({
      eventType: 'organization.user.invited',
      orderBy: 'status',
      page: 2,
      perPage: 25,
      sort: 'asc',
    });
    expect(auditEventExportQuerySchema.parse({ format: 'csv', orderBy: 'eventType', sort: 'desc' })).toMatchObject({
      format: 'csv',
      orderBy: 'eventType',
      sort: 'desc',
    });
  });

  it('validates audit retention policy shapes', (): void => {
    expect(auditRetentionConfiguredPolicySchema.parse({ days: null, mode: 'inherit' })).toEqual({
      days: null,
      mode: 'inherit',
    });
    expect(auditRetentionConfiguredPolicySchema.safeParse({ days: null, mode: 'keep_days' }).success).toBe(false);
  });
});
