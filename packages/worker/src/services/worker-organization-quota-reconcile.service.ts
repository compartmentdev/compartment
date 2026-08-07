import { setTimeout as delay } from 'node:timers/promises';
import type {
  OrganizationQuotaReconcileTarget,
  WorkerCompleteOrganizationQuotaReconcileResponse,
} from '@compartment/contracts';
import { organizationGlobalCustomQuotaManifests, type KubeManifest, type KubeRuntime } from '@compartment/kube-runtime';
import { completeOrganizationQuotaReconcile, type CompartmentRequester } from '@compartment/sdk';
import type {
  OrganizationQuotaObservedManifest,
  OrganizationQuotaStatusCondition,
} from './worker-organization-quota-reconcile.service.types';

const quotaReadinessAttempts: number = 20;
const quotaReadinessPollIntervalMs: number = 250;

export async function executeOrganizationQuotaReconcile(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: OrganizationQuotaReconcileTarget,
): Promise<void> {
  try {
    const manifests: KubeManifest[] = organizationGlobalCustomQuotaManifests(target);
    await runtime.apply({ objects: manifests });
    await assertOrganizationQuotaReady(runtime, manifests);
  } catch (error) {
    await completeReconciliation(request, target, 'failed', readErrorMessage(typeof error === 'object' ? error : null));
    throw error;
  }
  await completeReconciliation(request, target, 'succeeded');
}

async function completeReconciliation(
  request: CompartmentRequester,
  target: OrganizationQuotaReconcileTarget,
  status: 'failed' | 'succeeded',
  message?: string,
): Promise<void> {
  const completion: WorkerCompleteOrganizationQuotaReconcileResponse = await completeOrganizationQuotaReconcile(
    request,
    {
      leaseId: target.leaseId,
      ...(message === undefined ? {} : { message }),
      organizationId: target.organizationId,
      status,
    },
  );
  assertCurrentLease(completion);
}

function assertCurrentLease(completion: WorkerCompleteOrganizationQuotaReconcileResponse): void {
  if (!completion.applied) {
    throw new Error('Organization quota reconciliation lease is no longer current.');
  }
}

async function assertOrganizationQuotaReady(runtime: KubeRuntime, manifests: KubeManifest[]): Promise<void> {
  for (const manifest of manifests) {
    for (let attempt: number = 1; attempt <= quotaReadinessAttempts; attempt += 1) {
      const observed: OrganizationQuotaObservedManifest | null = await runtime.read(manifest);
      if (observed?.status?.conditions?.some(isReadyCondition) === true) {
        break;
      }
      if (observed?.status?.conditions?.some(isFailedReadyCondition) === true || attempt === quotaReadinessAttempts) {
        throw new Error(`Organization quota ${manifest.metadata?.name ?? 'unknown'} is not ready.`);
      }
      await delay(quotaReadinessPollIntervalMs);
    }
  }
}

function isReadyCondition(condition: OrganizationQuotaStatusCondition): boolean {
  return condition.type === 'Ready' && condition.status === 'True';
}

function isFailedReadyCondition(condition: OrganizationQuotaStatusCondition): boolean {
  return condition.type === 'Ready' && condition.status === 'False';
}

function readErrorMessage(error: object | null): string {
  return error instanceof Error ? error.message : 'Organization quota reconciliation failed.';
}
