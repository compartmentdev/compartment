import type { KubeRolloutObservation } from '@compartment/kube-runtime';
import type { JsonValue } from '@compartment/utils';
import type { KubernetesApiErrorShape, KubernetesStatusShape } from './worker-deployment-quota-failure.service.types';

const kubernetesResourceQuotaMarker: string = 'exceeded quota:';
const capsuleGlobalCustomQuotaMarker: string = 'creating resource exceeds limit for GlobalCustomQuota';
const quotaGuidance: string =
  'Kubernetes resource quota exceeded. Reduce resource usage or ask an operator to increase the tenant quota.';

export function readDeploymentQuotaAdmissionFailure(error: Error): string | null {
  const apiError: KubernetesApiErrorShape = error;
  if (readStatusCode(apiError) !== 403) {
    return null;
  }
  const status: KubernetesStatusShape | null = readKubernetesStatus(apiError.body);
  return status?.reason === 'Forbidden' && typeof status.message === 'string'
    ? quotaFailureMessage(status.message)
    : null;
}

export function readDeploymentQuotaRolloutFailure(rollout: KubeRolloutObservation): string | null {
  const condition = rollout.conditions.find(
    (candidate): boolean =>
      candidate.type === 'ReplicaFailure' &&
      candidate.status === 'True' &&
      candidate.reason === 'FailedCreate' &&
      candidate.message !== undefined &&
      isQuotaFailureMessage(candidate.message),
  );
  return condition?.message === undefined ? null : quotaFailureMessage(condition.message);
}

function quotaFailureMessage(message: string): string | null {
  return isQuotaFailureMessage(message) ? `${quotaGuidance} ${message}` : null;
}

function isQuotaFailureMessage(message: string): boolean {
  return message.includes(kubernetesResourceQuotaMarker) || message.includes(capsuleGlobalCustomQuotaMarker);
}

function readStatusCode(error: KubernetesApiErrorShape): number | null {
  return error.code ?? error.statusCode ?? null;
}

function readKubernetesStatus(body: KubernetesStatusShape | string | undefined): KubernetesStatusShape | null {
  if (typeof body === 'string') {
    try {
      const parsed: JsonValue = JSON.parse(body) as JsonValue;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return {
        ...(typeof parsed.message === 'string' ? { message: parsed.message } : {}),
        ...(typeof parsed.reason === 'string' ? { reason: parsed.reason } : {}),
      };
    } catch {
      return null;
    }
  }
  return body ?? null;
}
