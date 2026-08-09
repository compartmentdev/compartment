import type { ProductJobClass } from '@compartment/contracts';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { productJobRuns, resourceReconcileRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { readReleaseResourceIds } from './product-job-release-readiness.query';
import type { ReleaseResourceIdRow } from './product-job-release-readiness.query.types';
import { lockResourceRuntimeClaims } from './resource-runtime-claim-lock.query';
import type { SubmittableProductJobRow, WrittenProductJobRow } from './product-job-kube-submission.query.types';

/**
 * Records that the worker may hand this Job's manifest to the API server, and refuses when a reconcile already owns
 * one of the resources it dials.
 *
 * The claim transaction cannot decide this. It releases the per-resource claim locks when it commits, and the
 * readiness gate that follows is a live Kubernetes read the control plane cannot make, so a reconcile can be claimed
 * between the two. Taking the same locks here closes that window instead of narrowing it: this and the reconcile
 * claim both re-read their fence while holding the locks, so exactly one of them proceeds. A refusal leaves the Job
 * claimable with no marker, which is also why an unsubmitted Job never fences and a Job parked on an unready
 * resource cannot stall the reconcile that readies it.
 */
export async function persistProductJobKubeSubmission(jobClass: ProductJobClass, identityId: string): Promise<boolean> {
  return await getApiDatabase().transaction(
    async (transaction: ApiDatabaseTransaction): Promise<boolean> =>
      await recordKubeSubmission(transaction, jobClass, identityId),
  );
}

async function recordKubeSubmission(
  transaction: ApiDatabaseTransaction,
  jobClass: ProductJobClass,
  identityId: string,
): Promise<boolean> {
  const row: SubmittableProductJobRow | undefined = await readProductJobSubmissionRow(
    transaction,
    jobClass,
    identityId,
  );
  if (row === undefined) {
    return false;
  }
  if (row.kubeJobSubmittedAt !== null) {
    return true;
  }
  const resourceIds: string[] = await readDialedResourceIds(transaction, jobClass, identityId, row.resourceIdsJson);
  await lockResourceRuntimeClaims(transaction, resourceIds);
  if (await hasRunningResourceReconcile(transaction, resourceIds)) {
    return false;
  }
  return await writeKubeSubmission(transaction, jobClass, identityId);
}

async function readProductJobSubmissionRow(
  transaction: ApiDatabaseTransaction,
  jobClass: ProductJobClass,
  identityId: string,
): Promise<SubmittableProductJobRow | undefined> {
  const [row]: SubmittableProductJobRow[] = await transaction
    .select({ kubeJobSubmittedAt: productJobRuns.kubeJobSubmittedAt, resourceIdsJson: productJobRuns.resourceIdsJson })
    .from(productJobRuns)
    .where(
      and(
        eq(productJobRuns.jobClass, jobClass),
        eq(productJobRuns.identityId, identityId),
        eq(productJobRuns.status, 'running'),
      ),
    )
    .limit(1);
  return row;
}

async function readDialedResourceIds(
  transaction: ApiDatabaseTransaction,
  jobClass: ProductJobClass,
  identityId: string,
  resourceIdsJson: string,
): Promise<string[]> {
  if (jobClass === 'resource-operation') {
    return JSON.parse(resourceIdsJson) as string[];
  }
  const rows: ReleaseResourceIdRow[] = await readReleaseResourceIds(transaction, identityId);
  return rows.map((row: ReleaseResourceIdRow): string => row.id);
}

/**
 * A `running` reconcile owns the resource whether or not its lease is still alive: an expired lease means a worker
 * died partway through a scale-down, so the Deployment may already be gone.
 */
async function hasRunningResourceReconcile(
  transaction: ApiDatabaseTransaction,
  resourceIds: string[],
): Promise<boolean> {
  if (resourceIds.length === 0) {
    return false;
  }
  const [active] = await transaction
    .select({ id: resourceReconcileRuns.id })
    .from(resourceReconcileRuns)
    .where(
      and(inArray(resourceReconcileRuns.projectResourceId, resourceIds), eq(resourceReconcileRuns.phase, 'running')),
    )
    .limit(1);
  return active !== undefined;
}

/**
 * Write-once: a `running` row is re-claimed after a worker restart, and `updated_at` anchors the execution deadline
 * in `productJobTimeoutMs`, so re-stamping would hand every retry a fresh budget and a stuck Job would never reach a
 * terminal status.
 */
async function writeKubeSubmission(
  transaction: ApiDatabaseTransaction,
  jobClass: ProductJobClass,
  identityId: string,
): Promise<boolean> {
  const submittedAt: Date = new Date();
  const written: WrittenProductJobRow[] = await transaction
    .update(productJobRuns)
    .set({ kubeJobSubmittedAt: submittedAt, updatedAt: submittedAt })
    .where(
      and(
        eq(productJobRuns.jobClass, jobClass),
        eq(productJobRuns.identityId, identityId),
        eq(productJobRuns.status, 'running'),
        isNull(productJobRuns.kubeJobSubmittedAt),
      ),
    )
    .returning({ id: productJobRuns.id });
  return written.length > 0;
}
