import { setTimeout as delay } from 'node:timers/promises';
import type {
  OrganizationQuotaReconcileTarget,
  WorkerCompleteOrganizationQuotaReconcileResponse,
} from '@compartment/contracts';
import {
  organizationGlobalCustomQuotaManifests,
  projectNamespaceOrganizationLabelManifest,
  type KubeManifest,
  type KubeObservedManifest,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import { completeOrganizationQuotaReconcile, type CompartmentRequester } from '@compartment/sdk';
import type {
  OrganizationQuotaObservedManifest,
  OrganizationQuotaStatusCondition,
} from './worker-organization-quota-reconcile.service.types';

const quotaReadinessDeadlineMs: number = 120_000;
const quotaReadinessPollIntervalMs: number = 1_000;
const namespaceBackfillDeadlineMs: number = 120_000;
const namespaceBackfillConcurrency: number = 10;

export async function executeOrganizationQuotaReconcile(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: OrganizationQuotaReconcileTarget,
): Promise<void> {
  try {
    const manifests: KubeManifest[] = organizationGlobalCustomQuotaManifests(target);
    await runtime.apply({ objects: manifests });
    await assertOrganizationQuotaReady(runtime, manifests);
    await backfillProjectNamespaceOrganizationLabels(runtime, target);
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
  while (Date.now() < deadline) {
    const observed: OrganizationQuotaObservedManifest | null = await runtime.read(manifest);
    if (observed?.status?.conditions?.some(isReadyCondition) === true) {
      return;
    }
    if (observed?.status?.conditions?.some(isFailedReadyCondition) === true) {
      break;
    }
    await delay(quotaReadinessPollIntervalMs);
  }
  throw new Error(`Organization quota ${manifest.metadata?.name ?? 'unknown'} is not ready.`);
}

async function backfillProjectNamespaceOrganizationLabels(
  runtime: KubeRuntime,
  target: OrganizationQuotaReconcileTarget,
): Promise<void> {
  const deadline: number = Date.now() + namespaceBackfillDeadlineMs;
  for (let offset: number = 0; offset < target.namespaceIds.length; offset += namespaceBackfillConcurrency) {
    const namespaceIds: string[] = target.namespaceIds.slice(offset, offset + namespaceBackfillConcurrency);
    await withinNamespaceBackfillDeadline(
      Promise.all(
        namespaceIds.map(
          async (namespaceId: string): Promise<void> =>
            await patchProjectNamespaceOrganizationLabel(runtime, namespaceId, target.organizationId),
        ),
      ).then((): void => undefined),
      deadline,
    );
  }
}

async function withinNamespaceBackfillDeadline(work: Promise<void>, deadline: number): Promise<void> {
  const remainingMs: number = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error('Organization quota namespace backfill did not finish within 120000ms.');
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout: Promise<void> = new Promise<void>((_resolve: () => void, reject: (error: Error) => void): void => {
    timer = setTimeout(
      (): void => reject(new Error('Organization quota namespace backfill did not finish within 120000ms.')),
      remainingMs,
    );
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function patchProjectNamespaceOrganizationLabel(
  runtime: KubeRuntime,
  namespaceId: string,
  organizationId: string,
): Promise<void> {
  const manifest: KubeManifest = projectNamespaceOrganizationLabelManifest(namespaceId, organizationId);
  const observed: KubeObservedManifest | null = await runtime.read(manifest);
  if (observed === null) {
    return;
  }
  assertCanonicalProjectNamespace(observed, namespaceId, organizationId);
  await runtime.mergePatchExisting(manifest);
}

function assertCanonicalProjectNamespace(
  observed: KubeObservedManifest,
  namespaceId: string,
  organizationId: string,
): void {
  const labels: Record<string, string> = observed.metadata?.labels ?? {};
  const observedOrganizationId: string | undefined = labels['compartment.dev/organization-id'];
  if (
    labels['app.kubernetes.io/managed-by'] !== 'compartment' ||
    labels['compartment.dev/namespace-id'] !== namespaceId ||
    labels['compartment.dev/project-id'] !== namespaceId ||
    (observedOrganizationId !== undefined && observedOrganizationId !== organizationId)
  ) {
    throw new Error(`Project namespace ${namespaceId} does not have canonical Compartment identity labels.`);
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
