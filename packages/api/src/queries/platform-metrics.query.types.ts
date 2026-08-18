import type { QueryResultRow } from 'pg';

export type PlatformDeploymentStatus = 'failed' | 'queued' | 'running' | 'stopped' | 'succeeded';

export type PlatformProvisioningState =
  | 'failed'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'teardown_failed'
  | 'teardown_pending'
  | 'teardown_preparing'
  | 'teardown_running'
  | 'teardown_succeeded';

export interface PlatformBuildQueueRow {
  active: number;
  oldestQueuedAt: Date | null;
  organizationId: string | null;
  queued: number;
  running: number;
}

export interface PlatformBuildQueueQueryRow extends QueryResultRow {
  active: number;
  oldestQueuedAt: string | null;
  organizationId: string | null;
  queued: number;
  running: number;
}

export interface PlatformDeploymentStatusRow extends QueryResultRow {
  count: number;
  status: PlatformDeploymentStatus;
}

export interface PlatformProvisioningStateRow extends QueryResultRow {
  count: number;
  state: PlatformProvisioningState;
}

export interface PlatformProvisioningSummaryRow extends QueryResultRow {
  attempts: number;
  permanentlyUnprovisionable: number;
}

export interface PlatformMetricsSnapshot {
  buildQueue: PlatformBuildQueueRow[];
  deployments: PlatformDeploymentStatusRow[];
  provisioning: PlatformProvisioningStateRow[];
  provisioningSummary: PlatformProvisioningSummaryRow;
}
