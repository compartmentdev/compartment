import type { KubeReadinessProbe } from './kube-application-projection.types';
import type { ResourceProjectionRow } from './kube-resource-projection.types';
import type { KubeDeploymentManifest } from './kube-runtime.types';

export const resourceReadinessTimeoutAnnotation: string = 'compartment.dev/resource-readiness-timeout-ms';

export function resourceReadinessProbe(port: number): KubeReadinessProbe {
  return {
    failureThreshold: 3,
    periodSeconds: 2,
    successThreshold: 1,
    tcpSocket: { port },
    timeoutSeconds: 1,
  };
}

export function resourceReadinessTimeoutMs(row: ResourceProjectionRow): number {
  return row.readiness?.timeoutMs ?? 90_000;
}

export function readResourceReadinessTimeoutMs(deployment: KubeDeploymentManifest): number {
  const configured: string | undefined = deployment.metadata?.annotations?.[resourceReadinessTimeoutAnnotation];
  if (configured !== undefined) {
    const timeoutMs: number = Number(configured);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      throw new Error('Resource reconcile Deployment readiness timeout annotation is invalid.');
    }
    return timeoutMs;
  }
  const progressDeadlineSeconds: number | undefined = deployment.spec?.progressDeadlineSeconds;
  if (progressDeadlineSeconds === undefined) {
    throw new Error('Resource reconcile Deployment progress deadline is missing.');
  }
  // Rollback snapshots persisted before the split deadline shipped contain only the original readiness deadline.
  return progressDeadlineSeconds * 1_000;
}
