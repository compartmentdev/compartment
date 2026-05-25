import { describe, expect, it } from 'vitest';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import {
  parseResourceDefinitionSnapshotJson,
  serializeResourceDefinitionSnapshot,
} from '../src/services/resources.service.storage';

describe('resource service storage', (): void => {
  it('serializes and parses versioned resource definition snapshots', (): void => {
    const serialized: string = serializeResourceDefinitionSnapshot(createProjectResourceRow());

    expect(parseResourceDefinitionSnapshotJson(serialized)).toMatchObject({
      image: 'postgres:16',
      operationsJson: '{"backup":null,"restore":null}',
      version: 1,
    });
  });

  it('rejects unsupported resource definition snapshots', (): void => {
    expect((): void => {
      parseResourceDefinitionSnapshotJson('{"image":"postgres:16"}');
    }).toThrow('Resource backup contains an unsupported resource definition snapshot.');
  });
});

function createProjectResourceRow(): ProjectResourceRow {
  const now: Date = new Date('2026-05-08T12:00:00.000Z');

  return {
    commandJson: '[]',
    containerId: 'container_postgres',
    createdAt: now,
    envJson: '[]',
    environmentId: 'env_production',
    hostname: 'postgres.production.internal-tools.resource.internal',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'operation_hash',
    operationsJson: '{"backup":null,"restore":null}',
    portsJson: '[5432]',
    readinessJson: 'null',
    restartPolicy: 'unless-stopped',
    runtimeDefinitionHash: 'runtime_hash',
    status: 'running',
    updatedAt: now,
    volumesJson: '[]',
  };
}
