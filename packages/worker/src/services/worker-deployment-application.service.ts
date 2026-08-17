import type { DeploymentReconcileProjection, DeploymentReconcileTarget } from '@compartment/contracts';
import {
  projectApplicationManifests,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeObservedManifest,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import { decryptTenantProjection, tenantApplicationProbe } from '../tenant-workload-projections';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';
import { deploymentFromObjects } from './worker-deployment-reconcile.helpers';
import { projectProjectNetworkPolicyManifests } from './worker-network-policy.service';

const recoveryRestartedAnnotation: string = 'compartment.dev/recovery-restarted';

interface DeploymentCleanupIdentity {
  labels: Record<string, string>;
  namespace: string;
}

export interface AppliedPendingApplication {
  deployment: KubeDeploymentManifest;
  recoveryRestarted: boolean;
}

export async function applyApplication(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
  workerImage: string,
): Promise<KubeDeploymentManifest> {
  return deploymentFromObjects(
    await runtime.apply({
      objects: [
        ...projectProjectNetworkPolicyManifests(target.candidate.projectId, target.networkPolicy),
        ...projectApplicationObjects(
          target.candidate,
          tenantSecretsKek,
          infrastructureTimeoutMs,
          scheduling,
          workerImage,
        ),
      ],
    }),
  );
}

/**
 * The reachability probe rides on the Pod template, so every projection of this deployment carries it: the same
 * manifest is applied on rollout, on restart, and on rollback recovery, and a scale-up Pod no controller observes
 * still waits for the resources its service declares.
 */
export function projectApplicationObjects(
  projection: DeploymentReconcileProjection,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
  workerImage: string,
): KubeManifest[] {
  return projectApplicationManifests(
    {
      ...decryptTenantProjection(projection, scheduling, tenantSecretsKek),
      resourceProbe: tenantApplicationProbe(projection, workerImage),
    },
    infrastructureTimeoutMs,
  );
}

export async function applyPendingApplication(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
  workerImage: string,
): Promise<AppliedPendingApplication> {
  const candidateObjects: KubeManifest[] = projectApplicationObjects(
    target.candidate,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    scheduling,
    workerImage,
  );
  const recoveryRestarted: boolean = await readRecoveryRestarted(runtime, target, candidateObjects);
  const pendingObjects: KubeManifest[] = recoveryRestarted
    ? includeRecoveryRestartedAnnotation(candidateObjects)
    : candidateObjects;
  const deployment: KubeDeploymentManifest = deploymentFromObjects(
    await runtime.apply({
      objects: [
        ...projectProjectNetworkPolicyManifests(target.candidate.projectId, target.networkPolicy),
        ...pendingObjects,
      ],
    }),
  );
  return { deployment, recoveryRestarted };
}

export async function deleteApplication(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
  workerImage: string,
): Promise<void> {
  await runtime.delete(
    projectApplicationObjects(target.candidate, tenantSecretsKek, infrastructureTimeoutMs, scheduling, workerImage),
  );
}

async function recoverFailedRollout(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
  workerImage: string,
): Promise<void> {
  if (target.active === null) {
    return;
  }
  await runtime.apply({
    force: true,
    objects: [
      ...projectProjectNetworkPolicyManifests(target.active.projectId, target.networkPolicy),
      ...activeRecoveryObjects(
        target.active,
        target.candidate,
        tenantSecretsKek,
        infrastructureTimeoutMs,
        scheduling,
        workerImage,
      ),
    ],
  });
}

export async function cleanupFailedRollout(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
  workerImage: string,
): Promise<void> {
  const candidateObjects: KubeManifest[] = projectApplicationObjects(
    target.candidate,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    scheduling,
    workerImage,
  );
  if (target.active?.deploymentId === target.candidate.deploymentId) {
    await recoverFailedRollout(runtime, target, tenantSecretsKek, infrastructureTimeoutMs, scheduling, workerImage);
    return;
  }
  if (target.active === null) {
    await runtime.delete(candidateObjects);
    return;
  }
  await cleanupDistinctFailedRollout(
    runtime,
    target,
    candidateObjects,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    scheduling,
    workerImage,
  );
}

async function cleanupDistinctFailedRollout(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  candidateObjects: KubeManifest[],
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
  workerImage: string,
): Promise<void> {
  await recoverFailedRollout(runtime, target, tenantSecretsKek, infrastructureTimeoutMs, scheduling, workerImage);
  const candidateDeployment: KubeDeploymentManifest = deploymentFromObjects(candidateObjects);
  const identity: DeploymentCleanupIdentity = requiredDeploymentCleanupIdentity(candidateDeployment);
  const observation = await observeCandidateReplicaSets(runtime, identity);
  try {
    const candidateSecret: KubeManifest | undefined = candidateObjects.find(
      (object: KubeManifest): boolean => object.kind === 'Secret',
    );
    const replicaSets: KubeManifest[] = [...observation.cache.values()].filter(
      (object: KubeObservedManifest): object is KubeManifest => object.kind === 'ReplicaSet',
    );
    await runtime.delete([...(candidateSecret === undefined ? [] : [candidateSecret]), ...replicaSets]);
  } finally {
    await observation.stop();
  }
}

async function observeCandidateReplicaSets(runtime: KubeRuntime, identity: DeploymentCleanupIdentity) {
  return await runtime.observe({ labels: identity.labels, namespace: identity.namespace, resources: ['replicasets'] });
}

function requiredDeploymentCleanupIdentity(deployment: KubeDeploymentManifest): DeploymentCleanupIdentity {
  const labels: Record<string, string> | undefined = deployment.metadata?.labels;
  const namespace: string | undefined = deployment.metadata?.namespace;
  if (labels === undefined || namespace === undefined) {
    throw new Error('Candidate Kubernetes Deployment cleanup requires ownership labels and a namespace.');
  }
  return { labels, namespace };
}

async function readRecoveryRestarted(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  applicationObjects: KubeManifest[],
): Promise<boolean> {
  if (target.active?.deploymentId !== target.candidate.deploymentId) {
    return false;
  }
  return hasRecoveryRestartedAnnotation(await runtime.read(deploymentFromObjects(applicationObjects)));
}

function hasRecoveryRestartedAnnotation(observed: KubeObservedManifest | null): boolean {
  return observed?.kind === 'Deployment' && observed.metadata?.annotations?.[recoveryRestartedAnnotation] === 'true';
}

function activeRecoveryObjects(
  active: DeploymentReconcileProjection,
  candidate: DeploymentReconcileProjection,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
  workerImage: string,
): KubeManifest[] {
  const activeObjects: KubeManifest[] = projectApplicationObjects(
    active,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    scheduling,
    workerImage,
  );
  return active.deploymentId === candidate.deploymentId
    ? includeRecoveryRestartedAnnotation(activeObjects)
    : activeObjects;
}

export function includeRecoveryRestartedAnnotation(objects: KubeManifest[]): KubeManifest[] {
  return objects.map(
    (object: KubeManifest): KubeManifest =>
      object.kind === 'Deployment'
        ? {
            ...object,
            metadata: {
              ...object.metadata,
              annotations: { ...object.metadata?.annotations, [recoveryRestartedAnnotation]: 'true' },
            },
          }
        : object,
  );
}
