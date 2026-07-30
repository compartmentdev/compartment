import type {
  DeploymentArtifactCleanupTarget,
  DeploymentReconcileProjection,
  DeploymentReconcileTarget,
  ProductJobIntent,
  WorkerObserveDeploymentReconcileRequest,
} from '@compartment/contracts';
import {
  kubeNamespaceName,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeRolloutStatus,
} from '@compartment/kube-runtime';
import { observeDeploymentReconcile, type CompartmentRequester } from '@compartment/sdk';

export function releaseIntent(projection: DeploymentReconcileProjection, timeoutMs: number): ProductJobIntent | null {
  if (projection.releaseCommand === null) {
    return null;
  }
  return {
    command: ['sh', '-c', projection.releaseCommand],
    deploymentId: projection.deploymentId,
    env: projection.env,
    image: projection.image,
    imagePullSecretId: projection.imagePullSecretId,
    jobClass: 'release',
    namespace: kubeNamespaceName(projection.namespaceId),
    projectId: projection.projectId,
    timeoutMs,
  };
}

export function deploymentFromObjects(objects: KubeManifest[]): KubeDeploymentManifest {
  const deployment: KubeDeploymentManifest | undefined = objects.find(
    (object: KubeManifest): object is KubeDeploymentManifest => object.kind === 'Deployment',
  );
  if (deployment === undefined) {
    throw new Error('Application projection did not contain a Kubernetes Deployment.');
  }
  return deployment;
}

export function rolloutFailureMessage(status: Exclude<KubeRolloutStatus, 'progressing' | 'ready'>): string {
  return status === 'progress-deadline-exceeded'
    ? 'Kubernetes rollout exceeded its progress deadline.'
    : 'Kubernetes rollout timed out.';
}

export async function persistDeploymentObservation(
  request: CompartmentRequester,
  target: DeploymentReconcileTarget,
  observation: 'pending' | 'ready' | 'failed' | 'stopped',
  message?: string,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const input: WorkerObserveDeploymentReconcileRequest = {
    deploymentId: target.candidate.deploymentId,
    ...(message === undefined ? {} : { message }),
    observation,
    observedAt: new Date().toISOString(),
    revision: target.revision,
  };
  return (await observeDeploymentReconcile(request, input)).cleanupArtifacts;
}
