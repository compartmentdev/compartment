import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ResourceOperationProductJobIntent, WorkerPersistProductJobResultRequest } from '@compartment/contracts';
import { immutableKubeName } from '@compartment/utils';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import type { ResourceBackupOperationContext } from '../src/services/resource-backups.operation-context.service';
import type { StoredResourceOperationConfig } from '../src/services/resources.service.storage';
import {
  runKubernetesResourceOperation,
  runVerifiedKubernetesRestore,
  summarizeKubernetesBackupArtifact,
} from '../src/services/resource-backups.kubernetes.service';
import type { ResourceBackupRow } from '../src/queries/resource-backups.query.types';
import type { ResourceEnvironmentContext } from '../src/services/resources.service.types';

interface TestOperationInput {
  backupId: string;
  context: ResourceEnvironmentContext;
  operationContext: ResourceBackupOperationContext;
  operationId: string;
  operationKind: 'backup' | 'restore';
  resource: ProjectResourceRow;
}

interface TestVerifierInput {
  backupId: string;
  context: ResourceEnvironmentContext;
  operationId: string;
  resource: ProjectResourceRow;
}

const createIntent: Mock<(intent: ResourceOperationProductJobIntent) => Promise<void>> = vi.hoisted(
  (): Mock<(intent: ResourceOperationProductJobIntent) => Promise<void>> => vi.fn(),
);
const readResult: Mock<() => Promise<WorkerPersistProductJobResultRequest | null>> = vi.hoisted(
  (): Mock<() => Promise<WorkerPersistProductJobResultRequest | null>> => vi.fn(),
);
const getApiConfig: Mock<() => { workerImageRef: string | null }> = vi.hoisted(
  (): Mock<() => { workerImageRef: string | null }> => vi.fn(),
);

vi.mock('../src/services/product-job.service', (): object => ({ createProductJobIntent: createIntent }));
vi.mock('../src/queries/product-job-runs.query', (): object => ({ readProductJobResult: readResult }));
vi.mock('../src/runtime/runtime-access', (): object => ({ getApiConfig }));

describe('Kubernetes resource backup operations', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    createIntent.mockResolvedValue();
    getApiConfig.mockReturnValue({ workerImageRef: 'compartment-worker@sha256:abc' });
    readResult.mockResolvedValue({
      completedAt: '2026-07-12T12:00:00.000Z',
      exitCode: 0,
      identityId: 'op_backup',
      jobClass: 'resource-operation',
      jobName: 'job-backup',
      logs: 'backup complete',
      podName: 'job-backup-pod',
      status: 'succeeded',
    });
  });

  it('queues backup with guarded resource PVCs and writable artifact storage', async (): Promise<void> => {
    await runKubernetesResourceOperation(operationInput('backup'));
    const intent: ResourceOperationProductJobIntent | undefined = createIntent.mock.calls[0]?.[0];
    expect(intent).toMatchObject({
      command: ['sh', '-c', 'mkdir -p "$COMPARTMENT_BACKUP_DIR" && pg_dump'],
      env: { COMPARTMENT_BACKUP_DIR: '/backups/rbak_test' },
      jobClass: 'resource-operation',
      operationId: 'op_backup',
    });
    expect(intent?.volumeMounts).toEqual([
      expect.objectContaining({ expectedClaimUid: 'uid-backup', mountPath: '/backups', name: 'backup-artifacts' }),
    ]);
  });

  it('mounts backup artifacts read-only during restore', async (): Promise<void> => {
    await runKubernetesResourceOperation(operationInput('restore'));
    expect(createIntent.mock.calls[0]?.[0].volumeMounts?.at(-1)).toMatchObject({ readOnly: true });
  });

  it('parses one strict deterministic verifier metadata record', async (): Promise<void> => {
    const checksum: string = 'ab'.repeat(32);
    readResult.mockResolvedValue(
      terminalResult(`log\nCOMPARTMENT_ARTIFACT_METADATA {"checksum":"${checksum}","sizeBytes":42}\n`),
    );
    await expect(summarizeKubernetesBackupArtifact(verifierInput())).resolves.toMatchObject({
      checksum,
      sizeBytes: 42,
    });
    readResult.mockResolvedValue(terminalResult('missing'));
    await expect(summarizeKubernetesBackupArtifact(verifierInput())).rejects.toThrow('exactly one');
  });

  it('fails before enqueue when the platform worker image is missing', async (): Promise<void> => {
    getApiConfig.mockReturnValue({ workerImageRef: null });
    await expect(summarizeKubernetesBackupArtifact(verifierInput())).rejects.toThrow('COMPARTMENT_WORKER_IMAGE');
    expect(createIntent).not.toHaveBeenCalled();
  });

  it('prevents the restore user Job when verifier metadata mismatches', async (): Promise<void> => {
    const checksum: string = 'ab'.repeat(32);
    readResult.mockResolvedValue(
      terminalResult(`COMPARTMENT_ARTIFACT_METADATA {"checksum":"${checksum}","sizeBytes":42}`),
    );
    await expect(
      runVerifiedKubernetesRestore({
        backup: backup({ checksum: 'cd'.repeat(32), sizeBytes: 42 }),
        context: context(),
        operationContext: operationContext(),
        operationId: 'op_restore',
        resource: operationInput('restore').resource,
      }),
    ).rejects.toThrow('integrity verification failed');
    expect(createIntent).toHaveBeenCalledTimes(1);
  });

  it('returns verifier checksum and size for backup persistence', async (): Promise<void> => {
    const checksum: string = 'ab'.repeat(32);
    readResult.mockResolvedValue(
      terminalResult(`COMPARTMENT_ARTIFACT_METADATA {"checksum":"${checksum}","sizeBytes":42}`),
    );
    await expect(
      summarizeKubernetesBackupArtifact({
        backupId: 'rbak_test',
        context: context(),
        operationId: 'op_backup',
        resource: operationInput('backup').resource,
      }),
    ).resolves.toEqual({ checksum, location: 'pvc://rbak_test', sizeBytes: 42 });
  });
});

function terminalResult(logs: string): WorkerPersistProductJobResultRequest {
  return {
    completedAt: '2026-07-12T12:00:00.000Z',
    exitCode: 0,
    identityId: 'verify',
    jobClass: 'resource-operation',
    jobName: 'job-verify',
    logs,
    podName: 'job-verify-pod',
    status: 'succeeded',
  };
}

function backup(overrides: Partial<ResourceBackupRow>): ResourceBackupRow {
  return {
    artifactLocation: 'pvc://rbak_test',
    checksum: null,
    completedAt: new Date(),
    createdAt: new Date(),
    createdByPrincipalId: null,
    failureSummary: null,
    id: 'rbak_test',
    manifestJson: null,
    operationId: 'op',
    projectResourceId: 'res_postgres',
    purpose: 'manual',
    retentionDeletedAt: null,
    retentionReason: null,
    resourceDefinitionJson: null,
    sizeBytes: null,
    status: 'succeeded',
    stderrSummary: null,
    stdoutSummary: null,
    ...overrides,
  };
}

function operationInput(operationKind: 'backup' | 'restore'): TestOperationInput {
  const resourceId: string = 'res_postgres';
  const claimName: string = immutableKubeName('volume', `${resourceId}:backup-artifacts`);
  return {
    backupId: 'rbak_test',
    context: context(),
    operationContext: operationContext(),
    operationId: 'op_backup',
    operationKind,
    resource: { ...resource(), expectedClaimsJson: JSON.stringify([{ claimName, uid: 'uid-backup' }]), id: resourceId },
  };
}

function verifierInput(): TestVerifierInput {
  const input: TestOperationInput = operationInput('backup');
  return {
    backupId: input.backupId,
    context: input.context,
    operationId: input.operationId,
    resource: input.resource,
  };
}

function operationContext(): ResourceBackupOperationContext {
  const operation: StoredResourceOperationConfig = {
    command: 'pg_dump',
    env: [],
    image: 'postgres:16',
    schedule: null,
  };
  return {
    effectiveVariables: [],
    intent: {
      command: [],
      env: [],
      hostname: 'legacy',
      image: 'postgres:16',
      name: 'postgres',
      operationConfigHash: 'operation',
      operations: { backup: operation, restore: null },
      outputs: {},
      ports: [5432],
      readiness: null,
      restartPolicy: 'unless-stopped',
      runtimeEnv: [],
      runtimeHash: 'runtime',
      storedEnv: [],
      volumes: [{ mountPath: '/data', name: 'data' }],
    },
    operation,
  };
}

function resource(): ProjectResourceRow {
  return {
    commandJson: '[]',
    containerId: null,
    createdAt: new Date(),
    envJson: '[]',
    environmentId: 'env_prod',
    expectedClaimsJson: '[]',
    hostname: 'legacy',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'op',
    operationsJson: '{}',
    outputsJson: '{}',
    portsJson: '[5432]',
    readinessJson: 'null',
    restartPolicy: 'unless-stopped',
    runtimeDefinitionHash: 'runtime',
    runtimeKind: 'kubernetes',
    status: 'running',
    updatedAt: new Date(),
    volumesJson: '[{"mountPath":"/data","name":"data"}]',
  };
}

function context(): ResourceEnvironmentContext {
  return {
    environment: {
      createdAt: new Date(),
      id: 'env_prod',
      name: 'production',
      nodeId: 'node',
      projectId: 'prj',
      updatedAt: new Date(),
    },
    organization: { id: 'org', name: 'Organization', slug: 'organization' },
    project: {
      archivedAt: null,
      createdAt: new Date(),
      id: 'prj',
      name: 'project',
      organizationId: 'org',
      updatedAt: new Date(),
    },
  };
}
