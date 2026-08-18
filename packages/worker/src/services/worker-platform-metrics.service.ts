import {
  Counter,
  Gauge,
  createPrometheusRegistry,
  startPrometheusMetricsServer,
  type PrometheusMetricsServer,
  type Registry,
} from '@compartment/utils/metrics';
import type { WorkerConfig } from '../config';
import type { WorkerCaughtError } from '../logging/worker-error-log.types';
import type { WorkerBuildResult } from './worker-iteration.types';
import type {
  HandleWorkerBuildFailure,
  WorkerBuildMetricResult,
  WorkerPlatformMetricsRuntime,
} from './worker-platform-metrics.service.types';

const registry: Registry = createPrometheusRegistry('worker');
const activeBuilds: Gauge = new Gauge({
  help: 'Builds currently executing in this worker process.',
  name: 'compartment_worker_active_builds',
  registers: [registry],
});
const buildLimit = new Gauge<'scope'>({
  help: 'Configured build concurrency limits.',
  labelNames: ['scope'],
  name: 'compartment_build_queue_concurrency_limit',
  registers: [registry],
});
const builds = new Counter<'result'>({
  help: 'Build executions completed by this worker process.',
  labelNames: ['result'],
  name: 'compartment_worker_builds_total',
  registers: [registry],
});

export async function startWorkerPlatformMetrics(config: WorkerConfig): Promise<WorkerPlatformMetricsRuntime> {
  activeBuilds.set(0);
  builds.labels('failed').inc(0);
  builds.labels('succeeded').inc(0);
  buildLimit.set({ scope: 'global' }, config.buildQueue.maximumConcurrentBuilds);
  buildLimit.set({ scope: 'organization' }, config.buildQueue.maximumConcurrentBuildsPerOrganization);
  const server: PrometheusMetricsServer = await startPrometheusMetricsServer({
    host: '0.0.0.0',
    port: config.metricsPort,
    registry,
  });
  return { server };
}

function setWorkerActiveBuilds(count: number): void {
  activeBuilds.set(count);
}

function recordWorkerBuild(result: WorkerBuildMetricResult): void {
  builds.inc({ result });
}

export function trackWorkerBuildCompletion(
  activeBuildPromises: Set<Promise<void>>,
  completion: Promise<WorkerBuildResult>,
  handleFailure: HandleWorkerBuildFailure,
): void {
  const trackedCompletion: Promise<void> = completion
    .then((result: WorkerBuildResult): void => recordWorkerBuild(result))
    .catch((error: WorkerCaughtError): void => {
      recordWorkerBuild('failed');
      handleFailure(error);
    })
    .finally((): void => {
      activeBuildPromises.delete(trackedCompletion);
      setWorkerActiveBuilds(activeBuildPromises.size);
    });
  activeBuildPromises.add(trackedCompletion);
  setWorkerActiveBuilds(activeBuildPromises.size);
}
