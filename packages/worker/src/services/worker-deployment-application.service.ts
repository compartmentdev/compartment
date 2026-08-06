import type { DeploymentReconcileTarget, ProjectNetworkPolicyPorts } from '@compartment/contracts';
import {
  projectApplicationManifests,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import { decryptTenantProjection } from '../tenant-workload-projections';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';
import { deploymentFromObjects } from './worker-deployment-reconcile.helpers';
import {
  includeApplicationNetworkPolicyPorts,
  projectProjectNetworkPolicyManifests,
} from './worker-network-policy.service';

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
        ...projectProjectNetworkPolicyManifests(target.candidate.projectId, deploymentNetworkPolicy(target)),
        ...projectApplicationManifests(
          decryptTenantProjection(target.candidate, scheduling, tenantSecretsKek),
          infrastructureTimeoutMs,
        ),
      ],
    }),
  );
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
  const activeObjects: KubeManifest[] = projectApplicationManifests(
    decryptTenantProjection(target.active, scheduling, tenantSecretsKek),
    infrastructureTimeoutMs,
  );
  await runtime.apply({
    force: true,
    objects: [
      ...projectProjectNetworkPolicyManifests(target.candidate.projectId, deploymentNetworkPolicy(target)),
      ...activeObjects,
    ],
  });
}

export function deploymentNetworkPolicy(target: DeploymentReconcileTarget): ProjectNetworkPolicyPorts {
  return includeApplicationNetworkPolicyPorts(target.networkPolicy, target.candidate.containerPorts);
}
