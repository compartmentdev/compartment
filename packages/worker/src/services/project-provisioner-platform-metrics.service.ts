import {
  Counter,
  Gauge,
  createPrometheusRegistry,
  startPrometheusMetricsServer,
  type PrometheusMetricsServer,
  type Registry,
} from '@compartment/utils';

const registry: Registry = createPrometheusRegistry('project-provisioner');
const activeAttempts: Gauge = new Gauge({
  help: 'Project provisioning attempts currently executing in this process.',
  name: 'compartment_project_provisioning_active_attempts',
  registers: [registry],
});
const attempts = new Counter<'result'>({
  help: 'Project provisioning attempts completed by this process.',
  labelNames: ['result'],
  name: 'compartment_project_provisioning_attempts_total',
  registers: [registry],
});

export async function startProjectProvisionerPlatformMetrics(port: number): Promise<PrometheusMetricsServer> {
  activeAttempts.set(0);
  attempts.labels('failed').inc(0);
  attempts.labels('succeeded').inc(0);
  return await startPrometheusMetricsServer({ host: '0.0.0.0', port, registry });
}

export function setProjectProvisioningAttemptActive(active: boolean): void {
  activeAttempts.set(active ? 1 : 0);
}

export function recordProjectProvisioningAttempt(result: 'failed' | 'succeeded'): void {
  attempts.inc({ result });
}
