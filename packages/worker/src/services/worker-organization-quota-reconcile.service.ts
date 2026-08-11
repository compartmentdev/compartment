import { setTimeout as delay } from 'node:timers/promises';
import type {
  OrganizationQuotaReconcileTarget,
  WorkerCompleteOrganizationQuotaReconcileResponse,
} from '@compartment/contracts';
import {
  organizationGlobalCustomQuotaManifests,
  type KubeManifest,
  type KubeRuntime,
  type OrganizationQuotaCapacity,
} from '@compartment/kube-runtime';
import { completeOrganizationQuotaReconcile, type CompartmentRequester } from '@compartment/sdk';
import type {
  OrganizationQuotaObservedManifest,
  OrganizationQuotaStatusCondition,
} from './worker-organization-quota-reconcile.service.types';

const quotaReadinessDeadlineMs: number = 120_000;
const quotaReadinessPollIntervalMs: number = 1_000;
const reconcileRequestedAtAnnotation: string = 'reconcile.projectcapsule.dev/requestedAt';

export async function executeOrganizationQuotaReconcile(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: OrganizationQuotaReconcileTarget,
  capacity: OrganizationQuotaCapacity,
): Promise<void> {
  try {
    const manifests: KubeManifest[] = organizationGlobalCustomQuotaManifests({
      capacity,
      organizationId: target.organizationId,
      reconciliationRequestedAt: new Date().toISOString(),
    });
    const appliedManifests: KubeManifest[] = await runtime.apply({ objects: manifests });
    await assertOrganizationQuotaReady(runtime, appliedManifests);
  } catch (error) {
    const message: string = readErrorMessage(typeof error === 'object' ? error : null);
    await completeReconciliation(request, target, 'failed', message);
    throw new Error(`Organization quota reconciliation failed for ${target.organizationId}: ${message}`, {
      cause: error,
    });
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
  const deadline: number = Date.now() + quotaReadinessDeadlineMs;
  for (const manifest of manifests) {
    await waitForOrganizationQuotaReady(runtime, manifest, deadline);
  }
}

async function waitForOrganizationQuotaReady(
  runtime: KubeRuntime,
  manifest: KubeManifest,
  deadline: number,
): Promise<void> {
  const appliedGeneration: number | undefined = manifest.metadata?.generation;
  if (appliedGeneration === undefined) {
    throw new Error(`Organization quota ${manifest.metadata?.name ?? 'unknown'} has no applied generation.`);
  }
  while (Date.now() < deadline) {
    const observed: OrganizationQuotaObservedManifest | null = await runtime.read(manifest);
    const reconciliationPending: boolean =
      observed?.metadata?.annotations?.[reconcileRequestedAtAnnotation] !== undefined;
    if (
      !reconciliationPending &&
      observed?.status?.observedGeneration === appliedGeneration &&
      observed.status.conditions?.some(isReadyCondition) === true
    ) {
      return;
    }
    if (
      !reconciliationPending &&
      observed?.status?.observedGeneration === appliedGeneration &&
      observed.status.conditions?.some(isFailedReadyCondition) === true
    ) {
      break;
    }
    await delay(quotaReadinessPollIntervalMs);
  }
  throw new Error(`Organization quota ${manifest.metadata?.name ?? 'unknown'} is not ready.`);
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
