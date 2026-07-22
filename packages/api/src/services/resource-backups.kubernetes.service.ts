import {
  type ProductJobVolumeMount,
  type ResourceClaimIdentity,
  type ResourceOperationProductJobIntent,
  type WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import { immutableKubeName, kubeResourceServiceDns, type JsonValue } from '@compartment/utils';
import { createId } from '../lib/tokens';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import type { ResourceBackupArtifactSummary } from './resource-backup-artifact.types';
import { ResourceBackupRetentionOperationError } from './resource-backup-retention-operation.error';
import {
  assertKubernetesArtifactLocation,
  assertKubernetesRestoreArtifactIntegrity,
  kubeBackupArtifactLocation,
} from './resource-backups.kubernetes-artifact.service';
import { createProductJobIntent } from './product-job.service';
import type { ResourceOperationKind } from './resource-backups.operation-context.service';
import type {
  KubernetesArtifactMetadata,
  KubernetesBackupArtifactDeleteInput,
  KubernetesResourceOperationInput,
  KubernetesVerifiedRestoreInput,
} from './resource-backups.kubernetes.service.types';
import type { ResourceOperationDefinition, ResourceOperationResult } from './resource-operation.types';
import { waitForResourceOperationProductJob } from './resource-product-job-wait.service';
import { buildResourceOperationDefinition } from './resources.service.helpers';
import type { ResourceEnvironmentContext } from './resources.service.types';

const backupArtifactVolumeHandle: string = 'backup-artifacts';
const backupContainerRoot: string = '/backups';
const artifactMetadataMarker: string = 'COMPARTMENT_ARTIFACT_METADATA ';
const artifactVerifierScript: string = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const root=process.argv[1];function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);if(e.isDirectory())return files(p);if(!e.isFile())throw new Error('Artifact contains a non-file entry: '+p);return[p]})}const list=files(root).sort((a,b)=>path.relative(root,a).localeCompare(path.relative(root,b)));const hash=crypto.createHash('sha256');let sizeBytes=0;for(const file of list){const relative=path.relative(root,file),data=fs.readFileSync(file);hash.update(relative);hash.update('\\0');hash.update(data);hash.update('\\0');sizeBytes+=data.length}console.log('${artifactMetadataMarker}'+JSON.stringify({checksum:hash.digest('hex'),sizeBytes}));`;
const artifactDeleteScript: string = `require('node:fs').rmSync(process.argv[1],{force:true,recursive:true});`;

export async function runVerifiedKubernetesRestore(input: KubernetesVerifiedRestoreInput): Promise<void> {
  assertKubernetesArtifactLocation(input.backup);
  const metadata: KubernetesArtifactMetadata = await verifyKubernetesBackupArtifact({
    backupId: input.backup.id,
    context: input.context,
    operationId: input.operationId,
    resource: input.artifactResource,
  });
  assertKubernetesRestoreArtifactIntegrity(input.backup, metadata);
  await runKubernetesResourceOperation({
    backupId: input.backup.id,
    context: input.context,
    operationContext: input.operationContext,
    operationId: input.operationId,
    operationKind: 'restore',
    resource: input.resource,
    volumeResource: input.artifactResource,
  });
}

export async function summarizeKubernetesBackupArtifact(input: {
  backupId: string;
  context: ResourceEnvironmentContext;
  operationId: string;
  resource: ProjectResourceRow;
}): Promise<ResourceBackupArtifactSummary> {
  const metadata: KubernetesArtifactMetadata = await verifyKubernetesBackupArtifact(input);
  return { ...metadata, location: kubeBackupArtifactLocation(input.backupId) };
}

export async function deleteKubernetesBackupArtifact(input: KubernetesBackupArtifactDeleteInput): Promise<void> {
  assertKubernetesArtifactLocation(input.backup);
  const workerImageRef: string | null = getApiConfig().workerImageRef ?? null;
  if (workerImageRef === null) {
    throw new Error('COMPARTMENT_WORKER_IMAGE is required for Kubernetes backup retention.');
  }
  const intent: ResourceOperationProductJobIntent = {
    command: ['node', '-e', artifactDeleteScript, `${backupContainerRoot}/${input.backup.id}`],
    env: {},
    image: workerImageRef,
    jobClass: 'resource-operation',
    namespace: immutableKubeName('cpt', input.context.project.id),
    operationId: createId('resource_retention'),
    projectId: input.context.project.id,
    resourceIds: [input.resource.id],
    timeoutMs: 30_000,
    volumeMounts: buildVolumeMounts(input.resource, input.backup.id, 'cleanup'),
  };
  await createProductJobIntent(intent);
  const result: WorkerPersistProductJobResultRequest = await waitForResourceOperationProductJob(intent.operationId);
  if (result.status !== 'succeeded') {
    throw new ResourceBackupRetentionOperationError(`Kubernetes backup retention ${result.status}: ${result.logs}`);
  }
}

export async function runKubernetesResourceOperation(
  input: KubernetesResourceOperationInput,
): Promise<ResourceOperationResult> {
  const intent: ResourceOperationProductJobIntent = buildProductJobIntent(input);
  await createProductJobIntent(intent);
  const result: WorkerPersistProductJobResultRequest = await waitForResourceOperationProductJob(intent.operationId);
  if (result.status !== 'succeeded') {
    throw new Error(`Kubernetes resource ${input.operationKind} ${result.status}: ${result.logs}`);
  }
  return { stderr: '', stdout: result.logs };
}

async function verifyKubernetesBackupArtifact(input: {
  backupId: string;
  context: ResourceEnvironmentContext;
  operationId: string;
  resource: ProjectResourceRow;
}): Promise<KubernetesArtifactMetadata> {
  const workerImageRef: string | null = getApiConfig().workerImageRef ?? null;
  if (workerImageRef === null) {
    throw new Error('COMPARTMENT_WORKER_IMAGE is required for Kubernetes resource backup verification.');
  }
  const intent: ResourceOperationProductJobIntent = buildVerifierIntent(input, workerImageRef);
  await createProductJobIntent(intent);
  const result: WorkerPersistProductJobResultRequest = await waitForResourceOperationProductJob(intent.operationId);
  if (result.status !== 'succeeded') {
    throw new Error(`Kubernetes backup artifact verification ${result.status}: ${result.logs}`);
  }
  return parseKubernetesArtifactMetadata(result.logs);
}

function buildVerifierIntent(
  input: { backupId: string; context: ResourceEnvironmentContext; operationId: string; resource: ProjectResourceRow },
  workerImageRef: string,
): ResourceOperationProductJobIntent {
  const artifactDirectory: string = `${backupContainerRoot}/${input.backupId}`;
  return {
    command: ['node', '-e', artifactVerifierScript, artifactDirectory],
    env: {},
    image: workerImageRef,
    jobClass: 'resource-operation',
    namespace: immutableKubeName('cpt', input.context.project.id),
    operationId: `${input.operationId}-artifact-verify`,
    projectId: input.context.project.id,
    resourceIds: [input.resource.id],
    timeoutMs: 30_000,
    volumeMounts: buildVolumeMounts(input.resource, input.backupId, 'restore'),
  };
}

function parseKubernetesArtifactMetadata(logs: string): KubernetesArtifactMetadata {
  const markers: string[] = logs.split('\n').filter((line: string): boolean => line.startsWith(artifactMetadataMarker));
  if (markers.length !== 1) {
    throw new Error('Kubernetes backup verifier did not emit exactly one artifact metadata record.');
  }
  const parsed: JsonValue = JSON.parse(markers[0]!.slice(artifactMetadataMarker.length)) as JsonValue;
  return readKubernetesArtifactMetadata(parsed);
}

function readKubernetesArtifactMetadata(value: JsonValue): KubernetesArtifactMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Kubernetes backup verifier emitted invalid artifact metadata.');
  }
  const candidate: Record<string, JsonValue> = value;
  if (
    typeof candidate.checksum !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(candidate.checksum) ||
    typeof candidate.sizeBytes !== 'number' ||
    !Number.isSafeInteger(candidate.sizeBytes) ||
    candidate.sizeBytes < 0
  ) {
    throw new Error('Kubernetes backup verifier emitted invalid artifact metadata.');
  }
  return { checksum: candidate.checksum, sizeBytes: candidate.sizeBytes };
}

function buildProductJobIntent(input: KubernetesResourceOperationInput): ResourceOperationProductJobIntent {
  const definition: ResourceOperationDefinition = buildResourceOperationDefinition(
    input.operationContext.intent,
    input.operationContext.operation,
    input.operationContext.effectiveVariables,
  );
  return {
    command: buildOperationCommand(definition.command, input.operationKind),
    env: buildOperationEnvironment(input, definition.env),
    image: definition.image,
    jobClass: 'resource-operation',
    namespace: immutableKubeName('cpt', input.context.project.id),
    operationId: input.operationId,
    projectId: input.context.project.id,
    resourceIds: readOperationResourceIds(input),
    timeoutMs: input.operationContext.intent.readiness?.timeoutMs ?? 30_000,
    volumeMounts: buildVolumeMounts(input.volumeResource ?? input.resource, input.backupId, input.operationKind),
  };
}

function readOperationResourceIds(input: KubernetesResourceOperationInput): string[] {
  return [
    ...new Set(
      [input.resource.id, input.volumeResource?.id].filter((id: string | undefined): id is string => id !== undefined),
    ),
  ];
}

function buildOperationCommand(command: string, operationKind: ResourceOperationKind): string[] {
  return [
    'sh',
    '-c',
    operationKind === 'backup'
      ? `umask 0002 && mkdir -p "$COMPARTMENT_BACKUP_DIR" && chmod g+rwx "$COMPARTMENT_BACKUP_DIR" && ${command}`
      : command,
  ];
}

function buildOperationEnvironment(
  input: { backupId: string; context: ResourceEnvironmentContext; resource: ProjectResourceRow },
  env: { keyName: string; value: string }[],
): Record<string, string> {
  return {
    ...Object.fromEntries(
      env.map((value: { keyName: string; value: string }): [string, string] => [value.keyName, value.value]),
    ),
    COMPARTMENT_BACKUP_DIR: `${backupContainerRoot}/${input.backupId}`,
    COMPARTMENT_ENVIRONMENT_NAME: input.context.environment.name,
    COMPARTMENT_PROJECT_NAME: input.context.project.name,
    COMPARTMENT_RESOURCE_HOST: kubeResourceServiceDns(input.resource.id, input.context.project.id),
    COMPARTMENT_RESOURCE_NAME: input.resource.name,
  };
}

function buildVolumeMounts(
  resource: ProjectResourceRow,
  backupId: string,
  operationKind: ResourceOperationKind | 'cleanup',
): ProductJobVolumeMount[] {
  const expectedClaims: ResourceClaimIdentity[] = JSON.parse(resource.expectedClaimsJson) as ResourceClaimIdentity[];
  const claimName: string = immutableKubeName('volume', `${resource.id}:${backupArtifactVolumeHandle}`);
  const artifactClaim: ResourceClaimIdentity | undefined = expectedClaims.find(
    (claim: ResourceClaimIdentity): boolean => claim.claimName === claimName,
  );
  if (artifactClaim === undefined) {
    throw new Error(`Kubernetes resource operation refused: expected PVC identity for ${claimName} is missing.`);
  }
  return [
    {
      claimName,
      expectedClaimUid: artifactClaim.uid,
      mountPath: backupContainerRoot,
      name: backupArtifactVolumeHandle,
      ...(operationKind === 'restore' ? { readOnly: true } : {}),
      resourceId: resource.id,
    },
  ];
}
