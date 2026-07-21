import pino, { type Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerPublishPodMetricsRequest } from '@compartment/contracts';
import { kubeNamespaceName, type KubePodMetricObservation, type ObservePodMetrics } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { parseKubernetesQuantity } from '../src/services/kubernetes-quantity';
import { collectAndPublishPodMetrics } from '../src/services/worker-pod-metrics.service';
import type { PodMetricsRuntime } from '../src/services/worker-pod-metrics.service.types';

interface CapturedPodMetricsRequest {
  readonly body: WorkerPublishPodMetricsRequest;
}

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
  it('logs and isolates metrics-server and unavailable snapshot publication failures', async (): Promise<void> => {
    const metricsError: Error = new Error('metrics-server unavailable');
    const runtime: FailingMetricsRuntime = new FailingMetricsRuntime(metricsError);
    const request: CompartmentRequester = vi.fn();
    vi.mocked(request)
      .mockResolvedValueOnce({ namespaceIds: ['prj_1'] })
      .mockRejectedValueOnce(new Error('control plane unavailable'));
    const logger: Logger = pino({ level: 'silent' });
    vi.spyOn(logger, 'error');

    await expect(collectAndPublishPodMetrics(request, runtime, logger)).resolves.toBeUndefined();
    expect(runtime.lastInput?.namespaces).toEqual([kubeNamespaceName('prj_1')]);
    expect(logger.error).toHaveBeenCalledWith({ err: metricsError }, 'Kubernetes Pod metrics collection failed.');
    const publishInput: CapturedPodMetricsRequest | undefined = vi.mocked(request).mock.calls.at(1)?.[0] as
      | CapturedPodMetricsRequest
      | undefined;
    expect(publishInput?.body).toMatchObject({ pods: [], state: 'unavailable' });
  });
});

class FailingMetricsRuntime implements PodMetricsRuntime {
  public lastInput: ObservePodMetrics | undefined;

  public constructor(private readonly error: Error) {}

  public async observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricObservation[]> {
    this.lastInput = input;
    return await Promise.reject(this.error);
  }
}
