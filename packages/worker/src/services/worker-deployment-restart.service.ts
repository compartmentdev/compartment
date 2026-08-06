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
import { maximumRolloutDeadlineAt } from './worker-deployment-rollout-observation.service';
import type { DeploymentRolloutStartTracker } from './worker-deployment-rollout-start-tracker.service';
import {
  includeApplicationNetworkPolicyPorts,
  projectProjectNetworkPolicyManifests,
} from './worker-network-policy.service';

export async function restartActiveCandidate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<boolean> {
  if (!canRestartActiveCandidate(target, rolloutStarts)) {
    return false;
  }
  const objects: KubeManifest[] = buildRestartObjects(target, tenantSecretsKek, infrastructureTimeoutMs, scheduling);
  await runtime.delete([deploymentFromObjects(objects)]);
  await runtime.apply({
    force: true,
    objects,
  });
  const maximumDeadlineAt: Date = maximumRolloutDeadlineAt(target, infrastructureTimeoutMs);
  rolloutStarts.markRecoveryRestarted(target.candidate.deploymentId, maximumDeadlineAt);
  await persistRecoveryRestart(request, target);
  return true;
}

function canRestartActiveCandidate(
  target: DeploymentReconcileTarget,
  rolloutStarts: DeploymentRolloutStartTracker,
): boolean {
  return (
    target.active?.deploymentId === target.candidate.deploymentId &&
    rolloutStarts.canRestartRecovery(target.candidate.deploymentId)
  );
}

async function persistRecoveryRestart(request: CompartmentRequester, target: DeploymentReconcileTarget): Promise<void> {
  await persistDeploymentObservation(
    request,
    target,
    'pending',
    'Restarting an unhealthy active Kubernetes Deployment.',
  );
}

function buildRestartObjects(
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  scheduling: KubeWorkloadScheduling | undefined,
): KubeManifest[] {
  return [
    ...projectProjectNetworkPolicyManifests(
      target.candidate.projectId,
      includeApplicationNetworkPolicyPorts(target.networkPolicy, target.candidate.containerPorts),
    ),
    ...projectApplicationManifests(
      decryptTenantProjection(target.candidate, scheduling, tenantSecretsKek),
      infrastructureTimeoutMs,
    ),
  ];
}
