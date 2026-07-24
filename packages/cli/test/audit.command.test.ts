import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  auditEventListResponseSchema,
  type AuditEventExportQuery,
  type AuditEventListQuery,
  type AuditEventListResponse,
  type AuditEventSummary,
} from '@compartment/contracts';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandResult,
  type CliJsonResult,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

interface AuditCommandMocks {
  exportOrganizationAuditEvents: Mock<ExportOrganizationAuditEvents>;
  listOrganizationAuditEvents: Mock<ListOrganizationAuditEvents>;
  readCliConfig: Mock<ReadCliConfig>;
}

interface AuditEventsServiceModule {
  exportOrganizationAuditEvents: Mock<ExportOrganizationAuditEvents>;
  listOrganizationAuditEvents: Mock<ListOrganizationAuditEvents>;
}

interface ConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
}

type ExportOrganizationAuditEvents = (context: AuthenticatedContext, query: AuditEventExportQuery) => Promise<Buffer>;
type ListOrganizationAuditEvents = (
  context: AuthenticatedContext,
  query: AuditEventListQuery,
) => Promise<AuditEventListResponse>;
type ReadCliConfig = () => Promise<CliConfig>;

describe.sequential('compartment audit commands', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules(['../src/services/audit-events.service', '../src/store/config.store']);
  });

  it('renders audit events in text output and passes filters', async (): Promise<void> => {
    const mocks: AuditCommandMocks = mockAuditCommandModules();
    mocks.listOrganizationAuditEvents.mockResolvedValue(createAuditEventListResponse());

    const result: CliCommandResult = await runCliCommand([
      'audit',
      'list',
      '--from',
      '2026-05-01',
      '--to',
      '2026-05-02T10:00:00.000Z',
      '--event',
      'organization.role.created',
      '--actor',
      'admin@example.com',
      '--target-type',
      'role',
      '--project',
      'prj_123',
      '--page',
      '2',
      '--per-page',
      '10',
    ]);

    expectCliSuccess(result);
    expect(mocks.listOrganizationAuditEvents).toHaveBeenCalledWith(expect.anything(), {
      actor: 'admin@example.com',
      eventType: 'organization.role.created',
      from: '2026-05-01T00:00:00.000Z',
      page: 2,
      perPage: 10,
      project: 'prj_123',
      targetType: 'role',
      to: '2026-05-02T10:00:00.000Z',
    });
    expect(readCliStdout(result.capture).trim()).toBe(
      '2026-05-01T10:00:00.000Z\torganization.role.created\tsucceeded\tadmin@example.com\trole:Owner',
    );
  });

  it('emits the audit event list JSON contract', async (): Promise<void> => {
    const mocks: AuditCommandMocks = mockAuditCommandModules();
    mocks.listOrganizationAuditEvents.mockResolvedValue(createAuditEventListResponse());

    const result: CliJsonResult<AuditEventListResponse> = await runCliJson(
      ['audit', 'list', '--output', 'json'],
      auditEventListResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.events[0]?.id).toBe('aud_123');
  });

  it('exports NDJSON audit events to stdout', async (): Promise<void> => {
    const mocks: AuditCommandMocks = mockAuditCommandModules();
    mocks.exportOrganizationAuditEvents.mockResolvedValue(Buffer.from('{"id":"aud_123"}\n'));

    const result: CliCommandResult = await runCliCommand([
      'audit',
      'export',
      '--format',
      'ndjson',
      '--event',
      'organization.group.created',
    ]);

    expectCliSuccess(result);
    expect(mocks.exportOrganizationAuditEvents).toHaveBeenCalledWith(expect.anything(), {
      actor: undefined,
      eventType: 'organization.group.created',
      format: 'ndjson',
      from: undefined,
      project: undefined,
      targetType: undefined,
      to: undefined,
    });
    expect(readCliStdout(result.capture)).toBe('{"id":"aud_123"}\n');
  });

  it('rejects an invalid audit export format with a human-readable error', async (): Promise<void> => {
    const mocks: AuditCommandMocks = mockAuditCommandModules();

    const result: CliCommandResult = await runCliCommand(['audit', 'export', '--format', 'json']);

    expectCliFailure(result, 'Invalid format "json". Use one of: csv, ndjson.');
    expect(readCliStderr(result.capture)).not.toContain('invalid_enum_value');
    expect(mocks.exportOrganizationAuditEvents).not.toHaveBeenCalled();
  });
});

function createAuditEventListResponse(): AuditEventListResponse {
  return {
    events: [createAuditEventSummary()],
    pagination: {
      page: 1,
      perPage: 50,
      totalItems: 1,
      totalPages: 1,
    },
  };
}

function createAuditEventSummary(): AuditEventSummary {
  return {
    actor: {
      email: 'admin@example.com',
      principalId: 'prn_123',
      sessionId: 'ses_123',
      sourceIp: '203.0.113.10',
      transport: 'session',
      type: 'user',
      userAgent: 'compartment-cli',
    },
    eventType: 'organization.role.created',
    id: 'aud_123',
    metadata: {
      roleName: 'Owner',
    },
    occurredAt: '2026-05-01T10:00:00.000Z',
    organizationId: 'org_123',
    scopeType: 'organization',
    status: 'succeeded',
    target: {
      displayName: 'Owner',
      environmentId: null,
      id: 'rol_123',
      projectId: null,
      serviceId: null,
      type: 'role',
    },
  };
}

function mockAuditCommandModules(): AuditCommandMocks {
  const exportOrganizationAuditEventsMock: Mock<ExportOrganizationAuditEvents> = vi.fn<ExportOrganizationAuditEvents>();
  const listOrganizationAuditEventsMock: Mock<ListOrganizationAuditEvents> = vi.fn<ListOrganizationAuditEvents>();
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());

  vi.doMock(
    '../src/services/audit-events.service',
    (): AuditEventsServiceModule => ({
      exportOrganizationAuditEvents: exportOrganizationAuditEventsMock,
      listOrganizationAuditEvents: listOrganizationAuditEventsMock,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): ConfigStoreModule => ({
      readCliConfig: readCliConfigMock,
    }),
  );

  return {
    exportOrganizationAuditEvents: exportOrganizationAuditEventsMock,
    listOrganizationAuditEvents: listOrganizationAuditEventsMock,
    readCliConfig: readCliConfigMock,
  };
}
