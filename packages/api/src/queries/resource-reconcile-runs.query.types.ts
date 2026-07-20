import type {
  ResourceClaimIdentity,
  ResourceReconcileIntent,
  WorkerAcknowledgeResourceReconcileRequest,
} from '@compartment/contracts';
import type { SelectedFields, SelectedFieldsFlat } from 'drizzle-orm/pg-core/query-builders/select.types';
import type { projectKubeProvisioning, projectResources, resourceReconcileRuns } from '../db/schema';
import type { ProjectKubeProvisioningState } from './project-provisioning.query.types';
import type {
  PersistedProjectResourceRow,
  ProjectResourceRow,
  ProjectResourceRowStatus,
} from './resources.query.types';

export interface ClaimedResourceReconcileRun {
  expectedClaims: ResourceClaimIdentity[];
  intent: ResourceReconcileIntent;
  operationId: string;
  leaseId: string;
  previousManifestJson: string | null;
  type: 'bootstrap' | 'reconcile';
}

export interface CreateResourceReconcileRunInput {
  expectedClaims: ResourceClaimIdentity[];
  intent: ResourceReconcileIntent;
  operationId: string;
  type: 'bootstrap' | 'reconcile';
}

export type CreateResourceReconcileRunResult =
  | 'bootstrap-active'
  | 'created'
  | 'project-archived'
  | 'resource-deleting';

export interface ResourceReconcileRunState {
  failureMessage: string | null;
  phase: 'bootstrap-pending' | 'reconcile-pending' | 'running' | 'succeeded' | 'failed';
}

export interface ResourceDeletionRunState extends ResourceReconcileRunState {
  deleteData: boolean;
  operationId: string;
}

export interface ResourceDeletionDemandRow {
  deleteDataRequested: boolean;
  expectedClaimsJson: string;
}

export interface ResourceReconcileRunWaitState extends ResourceReconcileRunState {
  operationType: 'bootstrap' | 'reconcile';
  predecessorCount: number;
  predecessorProductJobCount: number;
  predecessorProductJobTimeoutMs: number;
  predecessorToken: string;
}

export interface ResourceReconcileSettlementState extends ResourceReconcileRunState {
  operationId: string;
}

export interface ResourceReconcileCreatedAtRow {
  createdAt: Date;
}

export interface ResourceReconcileRunLockRow {
  projectResourceId: string;
}

export interface ClaimableResourceReconcileRunLockRow {
  projectResourceId: string;
  runId: string;
}

export interface ResourceReconcileProjectLockRow {
  archivedAt: Date | null;
  resourceStatus: ProjectResourceRowStatus;
}

export interface ResourceBootstrapSettlement {
  provisioningAttempts: number;
  provisioningState: ProjectKubeProvisioningState;
  resource: ProjectResourceRow;
  state: ResourceReconcileSettlementState | null;
}

export type ResourceReconcileSettlement = ResourceBootstrapSettlement;

export interface ResourceReconcileSettlementRow {
  provisioningAttempts: number;
  provisioningState: ProjectKubeProvisioningState;
  resource: PersistedProjectResourceRow;
  state: ResourceReconcileSettlementState | null;
}

interface ResourceReconcileRunStateSelection extends SelectedFieldsFlat {
  failureMessage: typeof resourceReconcileRuns.failureMessage;
  operationId: typeof resourceReconcileRuns.id;
  phase: typeof resourceReconcileRuns.phase;
}

export interface ResourceReconcileSettlementSelection extends SelectedFields {
  provisioningAttempts: typeof projectKubeProvisioning.attempts;
  provisioningState: typeof projectKubeProvisioning.state;
  resource: typeof projectResources;
  state: ResourceReconcileRunStateSelection;
}

export type AcknowledgeResourceReconcileRunInput = WorkerAcknowledgeResourceReconcileRequest;
