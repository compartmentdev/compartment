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

  it('rejects an empty metrics-server snapshot while a live product Pod exists', async (): Promise<void> => {
    await expect(
      readKubePodMetrics(new StubCoreApi([productPod('pod-a', 'pod-uid-a')]), new StubMetricsApi([]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
      }),
    ).rejects.toThrow('metrics-server returned an incomplete product Pod snapshot.');
  });

  it('keeps sampled live Pod metrics while another live Pod is waiting for its sample', async (): Promise<void> => {
    const sampledPod: V1Pod = productPod('pod-a', 'pod-uid-a', 'Running');
    const unsampledPod: V1Pod = productPod('pod-b', 'pod-uid-b', 'Pending');

    await expect(
      readKubePodMetrics(new StubCoreApi([sampledPod, unsampledPod]), new StubMetricsApi([podMetric('pod-a')]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
      }),
    ).resolves.toMatchObject([
      {
        deploymentId: 'dep-a',
        podName: 'pod-a',
        podUid: 'pod-uid-a',
      },
    ]);
  });

  it('keeps live Pod metrics when a completed release Job has no metrics-server sample', async (): Promise<void> => {
    const livePod: V1Pod = productPod('pod-a', 'pod-uid-a', 'Running');
    const completedJobPod: V1Pod = releaseJobPod('release-job-a', 'release-job-uid-a');

    await expect(
      readKubePodMetrics(new StubCoreApi([livePod, completedJobPod]), new StubMetricsApi([podMetric('pod-a')]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
      }),
    ).resolves.toMatchObject([
      {
        deploymentId: 'dep-a',
        podName: 'pod-a',
        podUid: 'pod-uid-a',
      },
    ]);
  });

  it('returns no observations when only a completed release Job Pod exists', async (): Promise<void> => {
    const completedJobPod: V1Pod = releaseJobPod('release-job-a', 'release-job-uid-a');

    await expect(
      readKubePodMetrics(new StubCoreApi([completedJobPod]), new StubMetricsApi([]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
      }),
    ).resolves.toEqual([]);
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

function productPod(name: string, uid: string, phase: 'Pending' | 'Running' | 'Succeeded' = 'Running'): V1Pod {
  return {
    metadata: {
      labels: { 'app.kubernetes.io/managed-by': 'compartment', 'compartment.dev/deployment-id': 'dep-a' },
      name,
      namespace: 'cpt-project',
      uid,
    },
    status: { phase },
  };
}

function releaseJobPod(name: string, uid: string): V1Pod {
  const pod: V1Pod = productPod(name, uid, 'Succeeded');
  return {
    ...pod,
    metadata: {
      ...pod.metadata,
      ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name, uid: 'job-uid-a' }],
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
