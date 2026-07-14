import type { DeploymentReconcileProjection, ProductJobIntent } from '@compartment/contracts';
import {
  projectApplicationManifests,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeRolloutStatus,
} from '@compartment/kube-runtime';

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
    namespace: requiredDeploymentMetadata(deploymentManifest(projection), 'namespace'),
    timeoutMs,
  };
}

export function deploymentManifest(projection: DeploymentReconcileProjection): KubeDeploymentManifest {
  return deploymentFromObjects(projectApplicationManifests(projection));
}

function deploymentFromObjects(objects: KubeManifest[]): KubeDeploymentManifest {
  const deployment: KubeDeploymentManifest | undefined = objects.find(
    (object: KubeManifest): object is KubeDeploymentManifest => object.kind === 'Deployment',
  );
  if (deployment === undefined) {
    throw new Error('Application projection did not contain a Kubernetes Deployment.');
  }
  return deployment;
}

export function deploymentConditionStatus(value: string | undefined): 'False' | 'True' | 'Unknown' {
  if (value === 'False' || value === 'True') {
    return value;
  }
  return 'Unknown';
}

function requiredDeploymentMetadata(deployment: KubeDeploymentManifest, key: 'name' | 'namespace'): string {
  const value: string | undefined = deployment.metadata?.[key];
  if (value === undefined || value === '') {
    throw new Error(`Projected Kubernetes Deployment has no ${key}.`);
  }
  return value;
}

export function rolloutFailureMessage(status: Exclude<KubeRolloutStatus, 'progressing' | 'ready'>): string {
  return status === 'progress-deadline-exceeded'
    ? 'Kubernetes rollout exceeded its progress deadline.'
    : 'Kubernetes rollout timed out.';
}
