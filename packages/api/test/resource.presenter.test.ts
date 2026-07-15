import { describe, expect, it } from 'vitest';
import type { ResourceBackupListResponse } from '@compartment/contracts';
import { buildResourceBackupListResponse } from '../src/routes/resources/resource.presenter';
import type { EnvironmentRow } from '../src/queries/deployments.query.types';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
import type { ProjectRow } from '../src/queries/projects.query.types';
import type { ResourceBackupRow } from '../src/queries/resource-backups.query.types';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import type { ResourceBackupListResponseInput } from '../src/services/resources.service.types';

describe('resource presenter', (): void => {
  it('reports the latest retention cleanup timestamp for scheduled backups', (): void => {
    const response: ResourceBackupListResponse = buildResourceBackupListResponse({
      backups: [
        createBackup('rbak_newer_backup', '2026-05-08T12:00:00.000Z', '2026-05-08T12:30:00.000Z'),
        createBackup('rbak_older_backup', '2026-05-08T11:00:00.000Z', '2026-05-08T13:00:00.000Z'),
      ],
      environment: createEnvironment(),
      organization: createOrganization(),
      project: createProject(),
      resource: createResource(),
    } satisfies ResourceBackupListResponseInput);

    expect(response.scheduledOperation?.lastCleanupAt).toBe('2026-05-08T13:00:00.000Z');
  });
});

function createBackup(id: string, createdAt: string, retentionDeletedAt: string): ResourceBackupRow {
  return {
    artifactLocation: null,
    checksum: null,
    completedAt: new Date(createdAt),
    createdAt: new Date(createdAt),
    createdByPrincipalId: null,
    failureSummary: null,
    id,
    manifestJson: null,
    operationId: `op_${id}`,
    projectResourceId: 'res_postgres',
    purpose: 'scheduled',
    retentionDeletedAt: new Date(retentionDeletedAt),
    retentionReason: 'retention keepLast=1',
    resourceDefinitionJson: null,
    sizeBytes: null,
    status: 'deleted',
    stderrSummary: null,
    stdoutSummary: null,
  };
}

function createResource(): ProjectResourceRow {
  const now: Date = new Date('2026-05-08T10:00:00.000Z');
  return {
    commandJson: '[]',
    createdAt: now,
    envJson: '[]',
    environmentId: 'env_production',
    expectedClaimsJson: '[]',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'operation_hash',
    operationsJson:
      '{"backup":{"command":"pg_dump","env":[],"image":null,"schedule":{"interval":"daily"}},"restore":null}',
    portsJson: '[5432]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'runtime_hash',
    status: 'running',
    updatedAt: now,
    volumesJson: '[]',
  };
}

function createEnvironment(): EnvironmentRow {
  const now: Date = new Date('2026-05-08T10:00:00.000Z');
  return {
    createdAt: now,
    id: 'env_production',
    name: 'production',
    projectId: 'prj_internal_tools',
    updatedAt: now,
  };
}

function createProject(): ProjectRow {
  const now: Date = new Date('2026-05-08T10:00:00.000Z');
  return {
    archivedAt: null,
    createdAt: now,
    id: 'prj_internal_tools',
    name: 'internal-tools',
    organizationId: 'org_acme',
    updatedAt: now,
  };
}

function createOrganization(): OrganizationRow {
  return {
    id: 'org_acme',
    name: 'Acme',
    slug: 'acme',
  };
}
