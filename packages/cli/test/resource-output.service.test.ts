import type {
  ResourceBackupSummary,
  ResourceListResponse,
  ResourceOutputListResponse,
  ResourceOutputResponse,
  ResourceOutputSummary,
  ResourceResponse,
  ResourceSummary,
} from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import {
  createResourceDeleteMessage,
  createResourceBackupCreateMessage,
  createResourceBackupListMessage,
  createResourceBackupShowMessage,
  createResourceListMessage,
  createResourceLogsMessage,
  createResourceOutputListMessage,
  createResourceOutputShowMessage,
  createResourceResponseMessage,
  createResourceRestoreMessage,
} from '../src/commands/resources/resource.command.output';

describe('resource command output', (): void => {
  it('renders empty and populated resource lists', (): void => {
    expect(createResourceListMessage(createResourceListResponse([]))).toBe('No resources found for smoke/production.');
    expect(createResourceListMessage(createResourceListResponse([createResourceSummary()]))).toBe('postgres\trunning');
  });

  it('renders resource detail and logs without secret values', (): void => {
    expect(createResourceResponseMessage(createResourceResponse())).toBe(
      `postgres running
image: postgres:16
ports: 5432`,
    );
    expect(
      createResourceLogsMessage({
        ...createResourceResponse(),
        lines: [
          {
            message: 'ready',
            resourceName: 'postgres',
            stream: 'stdout',
            timestamp: '2026-04-29T10:00:00.000Z',
          },
        ],
      }),
    ).toBe('ready');
  });

  it('renders resource outputs without leaking hidden sensitive values', (): void => {
    const listResponse: ResourceOutputListResponse = {
      ...createResourceResponse(),
      outputs: [
        {
          name: 'connection-url',
          sensitivity: 'sensitive',
          value: null,
          valueFingerprint: null,
          valueHidden: true,
        },
        {
          name: 'host',
          sensitivity: 'plain',
          value: 'resource-res-123.cpt-prj-123.svc',
          valueFingerprint: 'b'.repeat(64),
          valueHidden: false,
        },
      ],
    };
    const showResponse: ResourceOutputResponse = {
      ...createResourceResponse(),
      output: readFirstResourceOutput(listResponse),
    };

    expect(createResourceOutputListMessage(listResponse)).toBe(
      'connection-url\tsensitive\t<hidden>\nhost\tplain\tresource-res-123.cpt-prj-123.svc',
    );
    expect(createResourceOutputShowMessage(showResponse)).toBe('connection-url\tsensitive\t<hidden>');
  });

  it('renders retained volume names for non-destructive deletes', (): void => {
    expect(createResourceDeleteMessage({ retainedVolumes: ['data'], success: true })).toBe(
      'Resource deleted. Retained volumes: data.',
    );
  });

  it('renders resource backup and restore results', (): void => {
    const backup: ResourceBackupSummary = {
      artifactLocation: '/var/lib/compartment/resource-backups/rbak_123',
      checksum: 'abc123',
      completedAt: '2026-04-29T10:01:00.000Z',
      createdAt: '2026-04-29T10:00:00.000Z',
      failureSummary: null,
      id: 'rbak_123',
      purpose: 'manual' as const,
      retentionDeletedAt: null,
      retentionReason: null,
      resource: createResourceSummary(),
      size: 12,
      status: 'succeeded' as const,
    };

    expect(
      createResourceBackupCreateMessage({
        ...createResourceListResponse([]),
        backup,
      }),
    ).toBe('Backup rbak_123 succeeded for resource postgres.');
    expect(
      createResourceBackupListMessage({
        ...createResourceResponse(),
        backups: [backup],
        scheduledOperation: null,
      }),
    ).toBe('rbak_123\tsucceeded\tmanual\t2026-04-29T10:00:00.000Z');
    expect(
      createResourceBackupShowMessage({
        ...createResourceListResponse([]),
        backup,
        manifest: null,
      }),
    ).toBe('rbak_123\tsucceeded\tmanual\t2026-04-29T10:00:00.000Z');
    expect(
      createResourceRestoreMessage({
        ...createResourceResponse(),
        preRestoreBackup: {
          ...backup,
          id: 'rbak_pre',
          purpose: 'pre_restore',
        },
        restoredBackup: backup,
        success: true,
      }),
    ).toBe('Resource postgres restored from backup rbak_123. Pre-restore backup: rbak_pre.');
    expect(
      createResourceRestoreMessage({
        ...createResourceResponse(),
        resource: {
          ...createResourceSummary(),
          name: 'postgres-restore',
        },
        restoredBackup: backup,
        success: true,
      }),
    ).toBe('Resource postgres-restore restored from backup rbak_123.');
  });
});

function createResourceListResponse(resources: ResourceSummary[]): ResourceListResponse {
  return {
    environment: {
      createdAt: '2026-04-29T10:00:00.000Z',
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: '2026-04-29T10:00:00.000Z',
    },
    project: {
      archivedAt: null,
      createdAt: '2026-04-29T10:00:00.000Z',
      id: 'prj_123',
      name: 'smoke',
      organizationId: 'org_123',
      updatedAt: '2026-04-29T10:00:00.000Z',
    },
    resources,
  };
}

function readFirstResourceOutput(response: ResourceOutputListResponse): ResourceOutputSummary {
  const output: ResourceOutputSummary | undefined = response.outputs[0];
  if (output === undefined) {
    throw new Error('Expected resource output fixture.');
  }

  return output;
}

function createResourceResponse(): ResourceResponse {
  return {
    ...createResourceListResponse([createResourceSummary()]),
    resource: createResourceSummary(),
  };
}

function createResourceSummary(): ResourceSummary {
  return {
    createdAt: '2026-04-29T10:00:00.000Z',
    env: [
      {
        keyName: 'POSTGRES_DB',
        sourceType: 'literal',
        variableName: null,
      },
    ],
    id: 'res_123',
    image: 'postgres:16',
    name: 'postgres',
    ports: [5432],
    readiness: null,
    status: 'running',
    updatedAt: '2026-04-29T10:00:00.000Z',
    volumes: [],
  };
}
