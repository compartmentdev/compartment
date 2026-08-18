import type { DeploymentReconcileState, ResourceReachabilityEndpoint } from '@compartment/contracts';
import type { AuditEventRow } from './audit-events.query.types';

export interface DeploymentReconcileRow {
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  image: string | null;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  resolvedPortsJson: string;
  resolvedReadinessJson: string;
  resolvedReleaseJson: string;
  resolvedRunJson: string;
  resourceEndpoints: ResourceReachabilityEndpoint[];
  revision: number;
  serviceId: string;
  serviceName: string;
  state: DeploymentReconcileState;
  transitionedAt: Date;
}

/** The reconcile row as the join selects it, before the resources it dials are read in the same transaction. */
export type DeploymentReconcileSelectedRow = Omit<DeploymentReconcileRow, 'resourceEndpoints'>;

export interface DeploymentReconcilePair {
  active: DeploymentReconcileRow | null;
  candidate: DeploymentReconcileRow;
}

export interface PersistDeploymentReconcileObservationInput {
  deploymentId: string;
  failureMessage: string | null;
  observation: 'pending' | 'ready' | 'failed' | 'stopped';
  observedAt: Date;
  revision: number;
}

export interface PersistDeploymentReconcileObservationResult {
  applied: boolean;
  auditEvents: AuditEventRow[];
  readyDurationSeconds?: number | undefined;
}

export type HandleCommittedDeploymentAuditEvents = (events: readonly AuditEventRow[]) => void;
export type HandleCommittedDeploymentReadyDuration = (durationSeconds: number) => void;

export interface PrepareDeploymentReconcileInput {
  deploymentId: string;
  deploymentName: string;
  id: string;
  imageRef: string;
  namespace: string;
  networkPolicyNames: string[];
  routeId: string;
  routeSubdomain: string;
  serviceName: string;
}

export interface PrepareDeploymentProjectRow {
  archivedAt: Date | null;
}

export type PrepareDeploymentReconcileResult = 'prepared' | 'project-archived';

export interface PrepareDeploymentRow {
  buildArtifactId: string;
  environmentId: string;
  serviceId: string;
}
