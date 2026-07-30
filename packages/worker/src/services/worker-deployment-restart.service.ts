import type { DeploymentReconcileTarget } from '@compartment/contracts';
import {
  projectApplicationManifests,
  type KubeManifest,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { decryptTenantProjection } from '../tenant-workload-projections';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';
import { deploymentFromObjects, persistDeploymentObservation } from './worker-deployment-reconcile.helpers';
import {
  includeApplicationNetworkPolicyPorts,
  projectProjectNetworkPolicyManifests,
} from './worker-network-policy.service';

export async function restartActiveCandidate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<boolean> {
  if (target.active?.deploymentId !== target.candidate.deploymentId) {
    return false;
  }
  const objects: KubeManifest[] = buildRestartObjects(target, tenantSecretsKek, scheduling);
  await runtime.delete([deploymentFromObjects(objects)]);
  await runtime.apply({
    force: true,
    objects,
  });
  await persistDeploymentObservation(
    request,
    target,
    'pending',
    'Restarting an unhealthy active Kubernetes Deployment.',
  );
  return true;
}

function buildRestartObjects(
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): KubeManifest[] {
  return [
    ...projectProjectNetworkPolicyManifests(
      target.candidate.projectId,
      includeApplicationNetworkPolicyPorts(target.networkPolicy, target.candidate.containerPorts),
    ),
    ...projectApplicationManifests(decryptTenantProjection(target.candidate, scheduling, tenantSecretsKek)),
  ];
}
