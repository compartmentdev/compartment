import type { PodMetric, V1Pod } from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';
import { readKubePodMetrics } from '../src/kube-pod-metrics';
import type { KubePodListReader, KubePodMetricsReader } from '../src/kube-pod-metrics.types';

describe('Kubernetes Pod metrics observation', (): void => {
  it('joins metrics-server samples to product Pods by namespace and name', async (): Promise<void> => {
    const coreApi: KubePodListReader = new StubCoreApi([productPod('pod-a', 'pod-uid-a')]);
    const metricsApi: KubePodMetricsReader = new StubMetricsApi([podMetric('pod-a')]);

    await expect(
      readKubePodMetrics(coreApi, metricsApi, {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
      }),
    ).resolves.toMatchObject([
      {
        containers: [{ cpu: '125m', memory: '64Mi' }],
        deploymentId: 'dep-a',
        namespace: 'cpt-project',
        podName: 'pod-a',
        podUid: 'pod-uid-a',
      },
    ]);
  });

  it('rejects an incomplete metrics-server snapshot', async (): Promise<void> => {
    await expect(
      readKubePodMetrics(new StubCoreApi([productPod('pod-a', 'pod-uid-a')]), new StubMetricsApi([]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
      }),
    ).rejects.toThrow('metrics-server returned an incomplete product Pod snapshot.');
  });
});

class StubCoreApi implements KubePodListReader {
  public constructor(private readonly items: V1Pod[]) {}

  public async listPodForAllNamespaces(): Promise<{ items: V1Pod[] }> {
    return await Promise.resolve({ items: this.items });
  }
}

class StubMetricsApi implements KubePodMetricsReader {
  public constructor(private readonly items: PodMetric[]) {}

  public async getPodMetrics(): Promise<{ items: PodMetric[] }> {
    return await Promise.resolve({ items: this.items });
  }
}

function productPod(name: string, uid: string): V1Pod {
  return {
    metadata: {
      labels: { 'app.kubernetes.io/managed-by': 'compartment', 'compartment.dev/deployment-id': 'dep-a' },
      name,
      namespace: 'cpt-project',
      uid,
    },
  };
}

function podMetric(name: string): PodMetric {
  return {
    containers: [{ name: 'app', usage: { cpu: '125m', memory: '64Mi' } }],
    metadata: {
      creationTimestamp: '2026-07-13T11:59:30.000Z',
      name,
      namespace: 'cpt-project',
      selfLink: `/apis/metrics.k8s.io/v1beta1/namespaces/cpt-project/pods/${name}`,
    },
    timestamp: '2026-07-13T12:00:00.000Z',
    window: '30s',
  };
}
