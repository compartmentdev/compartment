import { afterEach, describe, expect, it } from 'vitest';
import type { PrometheusMetricsServer } from '@compartment/utils/metrics';
import {
  recordProjectProvisioningAttempt,
  setProjectProvisioningAttemptActive,
  startProjectProvisionerPlatformMetrics,
} from '../src/services/project-provisioner-platform-metrics.service';

let server: PrometheusMetricsServer | null = null;

afterEach(async (): Promise<void> => {
  if (server !== null) {
    await server.close();
  }
  server = null;
});

describe('project provisioner platform metrics', (): void => {
  it('exports active state and bounded completion results', async (): Promise<void> => {
    server = await startProjectProvisionerPlatformMetrics(0);
    setProjectProvisioningAttemptActive(true);
    recordProjectProvisioningAttempt('failed');
    recordProjectProvisioningAttempt('succeeded');

    const activeOutput: string = await scrape(server.port);
    expect(activeOutput).toContain('compartment_project_provisioning_active_attempts 1');
    expect(activeOutput).toContain('compartment_project_provisioning_attempts_total{result="failed"} 1');
    expect(activeOutput).toContain('compartment_project_provisioning_attempts_total{result="succeeded"} 1');

    setProjectProvisioningAttemptActive(false);
    expect(await scrape(server.port)).toContain('compartment_project_provisioning_active_attempts 0');
  });
});

async function scrape(port: number): Promise<string> {
  return await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
}
