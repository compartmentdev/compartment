import pino, { type Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerPublishPodMetricsRequest } from '@compartment/contracts';
import {
  kubeNamespaceName,
  type KubePodMetricCollection,
  type KubePodMetricObservation,
  type ObservePodMetrics,
} from '@compartment/kube-runtime';
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
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('logs one namespace failure and publishes healthy namespace metrics as available', async (): Promise<void> => {
    const namespaceError: Error = new Error('metrics access denied');
    const runtime: PartialMetricsRuntime = new PartialMetricsRuntime(namespaceError);
    const request: CompartmentRequester = vi.fn();
    vi.mocked(request)
      .mockResolvedValueOnce({ namespaceIds: ['prj_1', 'prj_2'] })
      .mockResolvedValueOnce({});
    const logger: Logger = pino({ level: 'silent' });
    vi.spyOn(logger, 'warn');

    await expect(collectAndPublishPodMetrics(request, runtime, logger)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      { err: namespaceError, namespace: kubeNamespaceName('prj_2') },
      'Kubernetes Pod metrics namespace collection failed.',
    );
    const publishInput: CapturedPodMetricsRequest | undefined = vi.mocked(request).mock.calls.at(1)?.[0] as
      | CapturedPodMetricsRequest
      | undefined;
    expect(publishInput?.body).toMatchObject({
      pods: [{ namespace: kubeNamespaceName('prj_1'), podName: 'pod-a' }],
      state: 'available',
    });
  });

  it('publishes unavailable when every requested namespace fails', async (): Promise<void> => {
    const namespaceError: Error = new Error('metrics-server unavailable');
    const runtime: FailedNamespaceCollectionRuntime = new FailedNamespaceCollectionRuntime(namespaceError);
    const request: CompartmentRequester = vi.fn();
    vi.mocked(request)
      .mockResolvedValueOnce({ namespaceIds: ['prj_1'] })
      .mockResolvedValueOnce({});
    const logger: Logger = pino({ level: 'silent' });
    vi.spyOn(logger, 'error');

    await expect(collectAndPublishPodMetrics(request, runtime, logger)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      { err: new AggregateError([namespaceError], 'Kubernetes Pod metrics collection failed in every namespace.') },
      'Kubernetes Pod metrics collection failed.',
    );
    const publishInput: CapturedPodMetricsRequest | undefined = vi.mocked(request).mock.calls.at(1)?.[0] as
      | CapturedPodMetricsRequest
      | undefined;
    expect(publishInput?.body).toMatchObject({ pods: [], state: 'unavailable' });
  });

  it('logs transient missing samples at debug without making the snapshot unavailable', async (): Promise<void> => {
    const transientReason: Error = new Error('metrics-server has not sampled a fresh product Pod yet.');
    const runtime: TransientGapMetricsRuntime = new TransientGapMetricsRuntime(transientReason);
    const request: CompartmentRequester = vi.fn();
    vi.mocked(request)
      .mockResolvedValueOnce({ namespaceIds: ['prj_1'] })
      .mockResolvedValueOnce({});
    const logger: Logger = pino({ level: 'silent' });
    vi.spyOn(logger, 'debug');
    vi.spyOn(logger, 'warn');
    vi.spyOn(logger, 'error');

    await collectAndPublishPodMetrics(request, runtime, logger);

    expect(logger.debug).toHaveBeenCalledWith(
      { err: transientReason, namespace: kubeNamespaceName('prj_1') },
      'Kubernetes Pod metrics sample is temporarily missing.',
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect((vi.mocked(request).mock.calls.at(1)?.[0] as CapturedPodMetricsRequest).body.state).toBe('available');
  });

  it('rate-limits persistent aggregate failures and reports suppressed repeats', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T12:00:00.000Z'));
    const runtime: FailedNamespaceCollectionRuntime = new FailedNamespaceCollectionRuntime(
      new Error('metrics-server unavailable'),
    );
    const request: CompartmentRequester = vi.fn().mockResolvedValue({ namespaceIds: ['prj_1'] });
    const logger: Logger = pino({ level: 'silent' });
    vi.spyOn(logger, 'error');

    await collectAndPublishPodMetrics(request, runtime, logger);
    await collectAndPublishPodMetrics(request, runtime, logger);
    vi.advanceTimersByTime(300_000);
    await collectAndPublishPodMetrics(request, runtime, logger);

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenLastCalledWith(
      expect.objectContaining({ suppressedRepeats: 1 }),
      'Kubernetes Pod metrics collection failed.',
    );
  });

  it('logs a different persistent failure immediately', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T12:00:00.000Z'));
    const request: CompartmentRequester = vi.fn().mockResolvedValue({ namespaceIds: ['prj_1'] });
    const logger: Logger = pino({ level: 'silent' });
    vi.spyOn(logger, 'error');

    await collectAndPublishPodMetrics(
      request,
      new FailedNamespaceCollectionRuntime(new Error('metrics-server unavailable')),
      logger,
    );
    await collectAndPublishPodMetrics(
      request,
      new FailedNamespaceCollectionRuntime(new Error('metrics authorization denied')),
      logger,
    );

    expect(logger.error).toHaveBeenCalledTimes(2);
  });

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

  public async observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricCollection> {
    this.lastInput = input;
    return await Promise.reject(this.error);
  }
}

class PartialMetricsRuntime implements PodMetricsRuntime {
  public constructor(private readonly error: Error) {}

  public async observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricCollection> {
    return await Promise.resolve({
      failures: [{ namespace: input.namespaces[1]!, reason: this.error }],
      observations: [podObservation(input.namespaces[0]!)],
      persistentGaps: [],
      successfulNamespaceCount: 1,
      transientGaps: [],
    });
  }
}

class TransientGapMetricsRuntime implements PodMetricsRuntime {
  public constructor(private readonly reason: Error) {}

  public async observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricCollection> {
    return await Promise.resolve({
      failures: [],
      observations: [],
      persistentGaps: [],
      successfulNamespaceCount: 1,
      transientGaps: [{ namespace: input.namespaces[0]!, reason: this.reason }],
    });
  }
}

class FailedNamespaceCollectionRuntime implements PodMetricsRuntime {
  public constructor(private readonly error: Error) {}

  public async observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricCollection> {
    return await Promise.resolve({
      failures: [{ namespace: input.namespaces[0]!, reason: this.error }],
      observations: [],
      persistentGaps: [],
      successfulNamespaceCount: 0,
      transientGaps: [],
    });
  }
}

function podObservation(namespace: string): KubePodMetricObservation {
  return {
    containers: [{ cpu: '125m', memory: '64Mi' }],
    deploymentId: 'dep-a',
    namespace,
    observedAt: new Date('2026-07-13T12:00:00.000Z'),
    podName: 'pod-a',
    podUid: 'pod-uid-a',
  };
}
