import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import type { ResourceBackupRow } from '../src/queries/resource-backups.query.types';
import type { getApiConfig } from '../src/runtime/runtime-access';
import { requireBackupArtifactId } from '../src/services/resource-backups.operation-context.service';

type GetApiConfig = typeof getApiConfig;

interface RuntimeAccessMockModule {
  getApiConfig: Mock<GetApiConfig>;
}

interface ResourceBackupsOperationContextMocks {
  getApiConfig: Mock<GetApiConfig>;
}

const mocks: ResourceBackupsOperationContextMocks = vi.hoisted(
  (): ResourceBackupsOperationContextMocks => ({
    getApiConfig: vi.fn<GetApiConfig>(),
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): RuntimeAccessMockModule => ({
    getApiConfig: mocks.getApiConfig,
  }),
);

describe('requireBackupArtifactId', (): void => {
  beforeEach((): void => {
    mocks.getApiConfig.mockReset();
    mocks.getApiConfig.mockReturnValue({
      resourceBackupDirectory: '/var/lib/compartment/resource-backups',
    } as ApiConfig);
  });

  it('returns the backup id for artifacts in the configured backup directory', (): void => {
    expect(
      requireBackupArtifactId(
        createResourceBackupRow({
          artifactLocation: '/var/lib/compartment/resource-backups/rbak_123',
          id: 'rbak_123',
        }),
      ),
    ).toBe('rbak_123');
  });

  it('rejects restore for artifacts outside the configured backup directory', (): void => {
    expect((): string =>
      requireBackupArtifactId(
        createResourceBackupRow({
          artifactLocation: '/mnt/old-resource-backups/rbak_123',
          id: 'rbak_123',
        }),
      ),
    ).toThrow('Backup rbak_123 artifact location does not match the configured resource backup directory.');
  });
});

function createResourceBackupRow(overrides: Pick<ResourceBackupRow, 'artifactLocation' | 'id'>): ResourceBackupRow {
  return {
    artifactLocation: overrides.artifactLocation,
    checksum: null,
    completedAt: new Date('2026-05-07T00:00:01.000Z'),
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    createdByPrincipalId: 'prn_admin',
    failureSummary: null,
    id: overrides.id,
    manifestJson: null,
    operationId: 'op_backup',
    projectResourceId: 'res_postgres',
    purpose: 'manual',
    resourceDefinitionJson: null,
    retentionDeletedAt: null,
    retentionReason: null,
    sizeBytes: null,
    status: 'succeeded',
    stderrSummary: null,
    stdoutSummary: null,
  };
}
