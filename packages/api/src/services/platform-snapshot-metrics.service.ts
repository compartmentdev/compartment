import { Gauge, type Registry } from '@compartment/utils/metrics';
import type {
  PlatformBuildQueueRow,
  PlatformDeploymentStatus,
  PlatformMetricsSnapshot,
  PlatformProvisioningState,
} from '../queries/platform-metrics.query.types';

const deploymentStatuses: PlatformDeploymentStatus[] = ['queued', 'running', 'succeeded', 'failed', 'stopped'];
const provisioningStates: PlatformProvisioningState[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'teardown_preparing',
  'teardown_pending',
  'teardown_running',
  'teardown_succeeded',
  'teardown_failed',
];

export class ApiSnapshotMetrics {
  readonly #buildQueue: Gauge<'state'>;
  readonly #buildQueueByOrganization: Gauge<'organization_id' | 'state'>;
  readonly #oldestQueuedAge: Gauge;
  readonly #oldestQueuedAgeByOrganization: Gauge<'organization_id'>;
  readonly #deployments: Gauge<'status'>;
  readonly #provisioningProjects: Gauge<'state'>;
  readonly #provisioningAttempts: Gauge;
  readonly #permanentlyUnprovisionable: Gauge;

  constructor(registry: Registry) {
    this.#buildQueue = new Gauge({
      help: 'Current global build queue deployments by stand-compatible state.',
      labelNames: ['state'],
      name: 'compartment_build_queue_deployments',
      registers: [registry],
    });
    this.#buildQueueByOrganization = new Gauge({
      help: 'Current build queue deployments for organizations with live work.',
      labelNames: ['organization_id', 'state'],
      name: 'compartment_build_queue_deployments_by_organization',
      registers: [registry],
    });
    this.#oldestQueuedAge = new Gauge({
      help: 'Age in seconds of the oldest globally queued deployment.',
      name: 'compartment_build_queue_oldest_queued_age_seconds',
      registers: [registry],
    });
    this.#oldestQueuedAgeByOrganization = new Gauge({
      help: 'Age in seconds of the oldest queued deployment by organization.',
      labelNames: ['organization_id'],
      name: 'compartment_build_queue_oldest_queued_age_seconds_by_organization',
      registers: [registry],
    });
    this.#deployments = new Gauge({
      help: 'Current deployments by runtime status.',
      labelNames: ['status'],
      name: 'compartment_deployments',
      registers: [registry],
    });
    this.#provisioningProjects = new Gauge({
      help: 'Current projects by Kubernetes provisioning state.',
      labelNames: ['state'],
      name: 'compartment_project_provisioning_projects',
      registers: [registry],
    });
    this.#provisioningAttempts = new Gauge({
      help: 'Attempts recorded on current project provisioning state rows.',
      name: 'compartment_project_provisioning_attempts',
      registers: [registry],
    });
    this.#permanentlyUnprovisionable = new Gauge({
      help: 'Projects that exhausted provisioning attempts and remain failed.',
      name: 'compartment_project_permanently_unprovisionable',
      registers: [registry],
    });
  }

  apply(snapshot: PlatformMetricsSnapshot, now: Date): void {
    this.#applyBuildQueue(snapshot.buildQueue, now);
    this.#applyDeployments(snapshot);
    this.#applyProvisioning(snapshot);
  }

  #applyBuildQueue(rows: PlatformBuildQueueRow[], now: Date): void {
    this.#buildQueue.reset();
    this.#buildQueueByOrganization.reset();
    this.#oldestQueuedAge.reset();
    this.#oldestQueuedAgeByOrganization.reset();
    const global: PlatformBuildQueueRow | undefined = rows.find(
      (row: PlatformBuildQueueRow): boolean => row.organizationId === null,
    );
    setBuildQueue(this.#buildQueue, global ?? emptyBuildQueueRow());
    this.#oldestQueuedAge.set(ageSeconds(global?.oldestQueuedAt ?? null, now));
    for (const row of rows.filter(hasOrganizationId)) {
      setBuildQueueByOrganization(this.#buildQueueByOrganization, row);
      this.#oldestQueuedAgeByOrganization.set(
        { organization_id: row.organizationId! },
        ageSeconds(row.oldestQueuedAt, now),
      );
    }
  }

  #applyDeployments(snapshot: PlatformMetricsSnapshot): void {
    this.#deployments.reset();
    for (const status of deploymentStatuses) {
      this.#deployments.set({ status }, 0);
    }
    for (const row of snapshot.deployments) {
      this.#deployments.set({ status: row.status }, row.count);
    }
  }

  #applyProvisioning(snapshot: PlatformMetricsSnapshot): void {
    this.#provisioningProjects.reset();
    for (const state of provisioningStates) {
      this.#provisioningProjects.set({ state }, 0);
    }
    for (const row of snapshot.provisioning) {
      this.#provisioningProjects.set({ state: row.state }, row.count);
    }
    this.#provisioningAttempts.set(snapshot.provisioningSummary.attempts);
    this.#permanentlyUnprovisionable.set(snapshot.provisioningSummary.permanentlyUnprovisionable);
  }
}

function hasOrganizationId(row: PlatformBuildQueueRow): boolean {
  return row.organizationId !== null;
}

function emptyBuildQueueRow(): PlatformBuildQueueRow {
  return { active: 0, oldestQueuedAt: null, organizationId: null, queued: 0, running: 0 };
}

function setBuildQueue(metric: Gauge<'state'>, row: PlatformBuildQueueRow): void {
  metric.set({ state: 'queued' }, row.queued);
  metric.set({ state: 'active' }, row.active);
  metric.set({ state: 'running' }, row.running);
}

function setBuildQueueByOrganization(metric: Gauge<'organization_id' | 'state'>, row: PlatformBuildQueueRow): void {
  const organizationId: string = row.organizationId!;
  metric.set({ organization_id: organizationId, state: 'queued' }, row.queued);
  metric.set({ organization_id: organizationId, state: 'active' }, row.active);
  metric.set({ organization_id: organizationId, state: 'running' }, row.running);
}

function ageSeconds(timestamp: Date | null, now: Date): number {
  return timestamp === null ? 0 : Math.max(0, (now.getTime() - timestamp.getTime()) / 1_000);
}
