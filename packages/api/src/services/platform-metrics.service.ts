import {
  Counter,
  Gauge,
  Histogram,
  createPrometheusRegistry,
  type PrometheusMetricsServer,
  type Registry,
  startPrometheusMetricsServer,
} from '@compartment/utils';
import type { Pool } from 'pg';
import type { PlatformMetricsSnapshot } from '../queries/platform-metrics.query.types';
import { ApiSnapshotMetrics } from './platform-snapshot-metrics.service';
import type { ApiPlatformMetricsRuntime, CreateApiPlatformMetricsInput } from './platform-metrics.service.types';

const platformMetricsRefreshIntervalMs: number = 15_000;
const apiHttpMethods = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);

let activeMetrics: ApiMetricSet | null = null;

export function observeApiHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
  activeMetrics?.observeHttpRequest(method, route, statusCode, durationMs);
}

export function observeDeploymentSubmitToReady(durationSeconds: number): void {
  activeMetrics?.observeDeploymentSubmitToReady(durationSeconds);
}

export function createApiPlatformMetrics(
  input: CreateApiPlatformMetricsInput,
  host: string,
  port: number,
): ApiPlatformMetricsRuntime {
  const metrics = new ApiMetricSet(input.primaryPool, input.resourceOperationPool);
  activeMetrics = metrics;
  return new ApiPlatformMetrics(input, host, port, metrics);
}

class ApiPlatformMetrics implements ApiPlatformMetricsRuntime {
  #refreshPromise: Promise<void> | null = null;
  #refreshTimer: NodeJS.Timeout | null = null;
  #server: PrometheusMetricsServer | null = null;

  constructor(
    private readonly input: CreateApiPlatformMetricsInput,
    private readonly host: string,
    private readonly port: number,
    private readonly metrics: ApiMetricSet,
  ) {}

  async start(): Promise<number> {
    await this.#refresh();
    this.#server = await startPrometheusMetricsServer({
      host: this.host,
      port: this.port,
      registry: this.metrics.registry,
    });
    this.#refreshTimer = setInterval((): void => void this.#refresh(), platformMetricsRefreshIntervalMs);
    this.#refreshTimer.unref();
    return this.#server.port;
  }

  async stop(): Promise<void> {
    if (this.#refreshTimer !== null) {
      clearInterval(this.#refreshTimer);
    }
    if (this.#refreshPromise !== null) {
      await this.#refreshPromise;
    }
    if (this.#server !== null) {
      await this.#server.close();
    }
    if (activeMetrics === this.metrics) {
      activeMetrics = null;
    }
  }

  async #refresh(): Promise<void> {
    this.#refreshPromise ??= this.#refreshOnce().finally((): void => {
      this.#refreshPromise = null;
    });
    await this.#refreshPromise;
  }

  async #refreshOnce(): Promise<void> {
    try {
      const snapshot: PlatformMetricsSnapshot = await this.input.readSnapshot();
      this.metrics.applySnapshot(snapshot, new Date(Date.now()));
    } catch {
      this.metrics.recordCollectionError();
    }
  }
}

class ApiMetricSet {
  readonly registry: Registry = createPrometheusRegistry('api');
  readonly #snapshotMetrics: ApiSnapshotMetrics = new ApiSnapshotMetrics(this.registry);
  readonly #httpRequests = new Counter<'method' | 'route' | 'status_code'>({
    help: 'API HTTP requests completed.',
    labelNames: ['method', 'route', 'status_code'],
    name: 'compartment_api_http_requests_total',
    registers: [this.registry],
  });
  readonly #httpRequestDuration = new Histogram<'method' | 'route' | 'status_code'>({
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    help: 'API HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_code'],
    name: 'compartment_api_http_request_duration_seconds',
    registers: [this.registry],
  });
  readonly #deploymentReadyDuration = new Histogram({
    buckets: [30, 60, 120, 300, 600, 900, 1_800, 3_600],
    help: 'Duration from deployment submission until the deployment became ready.',
    name: 'compartment_deployment_submit_to_ready_duration_seconds',
    registers: [this.registry],
  });
  readonly #collectionErrors = new Counter({
    help: 'Platform database metrics snapshot collection failures.',
    name: 'compartment_platform_metrics_collection_errors_total',
    registers: [this.registry],
  });
  readonly #snapshotAge: Gauge;
  #collectedAtMs: number | null = null;

  constructor(primaryPool: Pool, resourceOperationPool: Pool) {
    this.#snapshotAge = new Gauge({
      collect: (): void => {
        this.#snapshotAge.set(
          this.#collectedAtMs === null
            ? Number.POSITIVE_INFINITY
            : Math.max(0, (Date.now() - this.#collectedAtMs) / 1_000),
        );
      },
      help: 'Age in seconds of the last successful platform database metrics snapshot.',
      name: 'compartment_platform_metrics_snapshot_age_seconds',
      registers: [this.registry],
    });
    createPoolMetric(this.registry, primaryPool, resourceOperationPool);
  }

  applySnapshot(snapshot: PlatformMetricsSnapshot, now: Date): void {
    this.#snapshotMetrics.apply(snapshot, now);
    this.#collectedAtMs = now.getTime();
  }

  observeHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const labels = {
      method: apiHttpMethods.has(method) ? method : 'OTHER',
      route,
      status_code: statusCode.toString(),
    };
    this.#httpRequests.inc(labels);
    this.#httpRequestDuration.observe(labels, durationMs / 1_000);
  }

  observeDeploymentSubmitToReady(durationSeconds: number): void {
    this.#deploymentReadyDuration.observe(durationSeconds);
  }

  recordCollectionError(): void {
    this.#collectionErrors.inc();
  }
}

function createPoolMetric(registry: Registry, primaryPool: Pool, resourceOperationPool: Pool): Gauge<'pool' | 'state'> {
  return new Gauge<'pool' | 'state'>({
    collect(): void {
      this.reset();
      setPoolValues(this, 'primary', primaryPool);
      setPoolValues(this, 'resource_operations', resourceOperationPool);
    },
    help: 'PostgreSQL pool connections by API pool and state.',
    labelNames: ['pool', 'state'],
    name: 'compartment_api_db_pool_connections',
    registers: [registry],
  });
}

function setPoolValues(metric: Gauge<'pool' | 'state'>, poolName: string, pool: Pool): void {
  metric.set({ pool: poolName, state: 'total' }, pool.totalCount);
  metric.set({ pool: poolName, state: 'idle' }, pool.idleCount);
  metric.set({ pool: poolName, state: 'waiting' }, pool.waitingCount);
}
