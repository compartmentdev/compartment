import { describe, expect, it } from 'vitest';
import type { KubePodMetricObservation, ObservePodMetrics } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { parseKubernetesQuantity } from '../src/services/kubernetes-quantity';
import { collectAndPublishPodMetrics } from '../src/services/worker-pod-metrics.service';
import type { PodMetricsRuntime } from '../src/services/worker-pod-metrics.service.types';

describe('Kubernetes resource quantities', (): void => {
  it('normalizes CPU usage to millicores', (): void => {
    expect(parseKubernetesQuantity('250m', 'cpu')).toBe(250);
    expect(parseKubernetesQuantity('125000000n', 'cpu')).toBe(125);
    expect(parseKubernetesQuantity('2', 'cpu')).toBe(2_000);
  });

  it('normalizes memory usage to bytes', (): void => {
    expect(parseKubernetesQuantity('64Ki', 'memory')).toBe(65_536);
    expect(parseKubernetesQuantity('2Mi', 'memory')).toBe(2_097_152);
    expect(parseKubernetesQuantity('2Ti', 'memory')).toBe(2_199_023_255_552);
    expect(parseKubernetesQuantity('1e3', 'memory')).toBe(1_000);
  });

  it('rejects unknown quantity suffixes', (): void => {
    expect((): number => parseKubernetesQuantity('2Zi', 'memory')).toThrow(
      'Unsupported Kubernetes memory quantity suffix: Zi.',
    );
  });
});

describe('Pod metric publication isolation', (): void => {
  it('does not propagate metrics-server and snapshot publication failures', async (): Promise<void> => {
    const runtime: PodMetricsRuntime = new FailingMetricsRuntime();
    const request: CompartmentRequester = async (): Promise<never> =>
      await Promise.reject(new Error('control plane unavailable'));

    await expect(collectAndPublishPodMetrics(request, runtime)).resolves.toBeUndefined();
  });
});

class FailingMetricsRuntime implements PodMetricsRuntime {
  public async observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricObservation[]> {
    void input;
    return await Promise.reject(new Error('metrics-server unavailable'));
  }
}
