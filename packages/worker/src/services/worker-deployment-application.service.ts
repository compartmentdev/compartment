import type {
  DeploymentReconcileProjection,
  DeploymentReconcileTarget,
  ProjectNetworkPolicyPorts,
} from '@compartment/contracts';
import {
  projectApplicationManifests,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeObservedManifest,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import { decryptTenantProjection } from '../tenant-workload-projections';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';
import { deploymentFromObjects } from './worker-deployment-reconcile.helpers';
import { projectProjectNetworkPolicyManifests } from './worker-network-policy.service';

const recoveryRestartedAnnotation: string = 'compartment.dev/recovery-restarted';

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
): Promise<KubeDeploymentManifest> {
  return deploymentFromObjects(
    await runtime.apply({
      objects: [
        ...projectProjectNetworkPolicyManifests(target.candidate.projectId, target.networkPolicy),
        ...projectApplicationManifests(
          decryptTenantProjection(target.candidate, scheduling, tenantSecretsKek),
          infrastructureTimeoutMs,
        ),
      ],
    }),
  );
}

export async function applyPendingApplication(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<AppliedPendingApplication> {
  const applicationObjects: KubeManifest[] = projectApplicationManifests(
    decryptTenantProjection(target.candidate, scheduling, tenantSecretsKek),
    infrastructureTimeoutMs,
  );
  const recoveryRestarted: boolean = await readRecoveryRestarted(runtime, target, applicationObjects);
  const pendingObjects: KubeManifest[] = recoveryRestarted
    ? includeRecoveryRestartedAnnotation(applicationObjects)
    : applicationObjects;
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
): Promise<void> {
  await runtime.delete(
    projectApplicationManifests(
      decryptTenantProjection(target.candidate, scheduling, tenantSecretsKek),
      infrastructureTimeoutMs,
    ),
  );
}

export async function recoverFailedRollout(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<void> {
  if (target.active === null) {
    return;
  }
  await runtime.apply({
    force: true,
    objects: recoveryObjects(
      target.active,
      target.candidate,
      target.networkPolicy,
      tenantSecretsKek,
      infrastructureTimeoutMs,
      scheduling,
    ),
  });
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

function recoveryObjects(
  active: DeploymentReconcileProjection,
  candidate: DeploymentReconcileProjection,
  networkPolicy: ProjectNetworkPolicyPorts,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
): KubeManifest[] {
  return [
    ...projectProjectNetworkPolicyManifests(active.projectId, networkPolicy),
    ...activeRecoveryObjects(active, candidate, tenantSecretsKek, infrastructureTimeoutMs, scheduling),
  ];
}

function activeRecoveryObjects(
  active: DeploymentReconcileProjection,
  candidate: DeploymentReconcileProjection,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
): KubeManifest[] {
  const activeObjects: KubeManifest[] = projectApplicationManifests(
    decryptTenantProjection(active, scheduling, tenantSecretsKek),
    infrastructureTimeoutMs,
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
