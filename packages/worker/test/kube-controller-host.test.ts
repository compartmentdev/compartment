import { afterEach, describe, expect, it } from 'vitest';
import { createKubeControllerHost } from '../src/kube-controller-host';
import type { WorkerConfig } from '../src/config';

const originalKubeServiceHost: string | undefined = process.env.KUBERNETES_SERVICE_HOST;
const originalKubeconfig: string | undefined = process.env.KUBECONFIG;

describe('createKubeControllerHost', (): void => {
  afterEach((): void => {
    restoreEnvironmentValue('KUBERNETES_SERVICE_HOST', originalKubeServiceHost);
    restoreEnvironmentValue('KUBECONFIG', originalKubeconfig);
  });

  it('fails before the build worker can claim work without Kubernetes access', (): void => {
    delete process.env.KUBERNETES_SERVICE_HOST;
    delete process.env.KUBECONFIG;

    expect((): void => {
      createKubeControllerHost({} as WorkerConfig);
    }).toThrow('Kubernetes worker requires KUBERNETES_SERVICE_HOST or KUBECONFIG.');
  });
});

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
