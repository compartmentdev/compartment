import { describe, expect, it } from 'vitest';
import {
  buildCompartmentResourceBackupCollectionPathname,
  buildCompartmentResourceBackupRestorePathname,
  buildCompartmentResourceBackupShowPathname,
  compartmentResourceBackupCollectionPathnameTemplate,
  compartmentResourceBackupsPathname,
  compartmentResourceBackupRestorePathnameTemplate,
  compartmentResourceBackupShowPathnameTemplate,
  resourceRestoreAsRequestSchema,
  resourceRestoreAsResponseSchema,
  type ResourceRestoreAsResponse,
} from '../src';

describe('resource backup contracts', (): void => {
  it('accepts restore-as requests and responses', (): void => {
    expect(compartmentResourceBackupsPathname).toBe('/v1/resource-backups');
    expect(compartmentResourceBackupCollectionPathnameTemplate).toBe('/v1/resources/:resourceName/backups');
    expect(buildCompartmentResourceBackupCollectionPathname('main db')).toBe('/v1/resources/main%20db/backups');
    expect(compartmentResourceBackupShowPathnameTemplate).toBe('/v1/resource-backups/:backupId');
    expect(buildCompartmentResourceBackupShowPathname('rbak_123')).toBe('/v1/resource-backups/rbak_123');
    expect(compartmentResourceBackupRestorePathnameTemplate).toBe('/v1/resource-backups/:backupId/restore');
    expect(buildCompartmentResourceBackupRestorePathname('rbak_123')).toBe('/v1/resource-backups/rbak_123/restore');
    expect(resourceRestoreAsRequestSchema.parse({ targetResourceName: 'db-restore' })).toEqual({
      targetResourceName: 'db-restore',
    });

    const response: ResourceRestoreAsResponse = {
      environment: {
        createdAt: '2026-05-08T10:00:00.000Z',
        id: 'env_123',
        name: 'production',
        projectId: 'prj_123',
        updatedAt: '2026-05-08T10:00:00.000Z',
      },
      project: {
        archivedAt: null,
        createdAt: '2026-05-08T10:00:00.000Z',
        id: 'prj_123',
        name: 'internal-tools',
        organizationId: 'org_123',
        updatedAt: '2026-05-08T10:00:00.000Z',
      },
      resource: {
        createdAt: '2026-05-08T10:00:00.000Z',
        env: [],
        id: 'res_restore',
        image: 'postgres:16',
        name: 'db-restore',
        ports: [5432],
        readiness: null,
        status: 'running',
        updatedAt: '2026-05-08T10:00:00.000Z',
        volumes: [],
      },
      restoredBackup: {
        artifactLocation: '/var/lib/compartment/resource-backups/rbak_123',
        checksum: 'sha256:abc123',
        completedAt: '2026-05-08T10:01:00.000Z',
        createdAt: '2026-05-08T10:00:00.000Z',
        failureSummary: null,
        id: 'rbak_123',
        purpose: 'manual',
        resource: {
          createdAt: '2026-05-08T09:00:00.000Z',
          env: [],
          id: 'res_source',
          image: 'postgres:16',
          name: 'db',
          ports: [5432],
          readiness: null,
          status: 'running',
          updatedAt: '2026-05-08T09:00:00.000Z',
          volumes: [],
        },
        retentionDeletedAt: null,
        retentionReason: null,
        size: 128,
        status: 'succeeded',
      },
      success: true,
    };

    expect(resourceRestoreAsResponseSchema.parse(response)).toEqual(response);
  });
});
