import type { PodMetric, V1Pod } from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';
import { readKubePodMetrics } from '../src/kube-pod-metrics';
import type { KubePodListReader, KubePodMetricsReader } from '../src/kube-pod-metrics.types';

describe('Kubernetes Pod metrics observation', (): void => {
  it('joins metrics-server samples to product Pods by namespace and name', async (): Promise<void> => {
    const coreApi: KubePodListReader = new StubCoreApi([
      productPod('pod-a', 'pod-uid-a'),
      productPod('pod-b', 'pod-uid-b'),
      productPod('pod-c', 'pod-uid-c', 'Running', 'cpt-project-two'),
    ]);
    const metricsApi: StubMetricsApi = new StubMetricsApi([
      podMetric('pod-a'),
      podMetric('pod-b'),
      podMetric('pod-c', 'cpt-project-two'),
    ]);

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
      {
        namespace: 'cpt-project',
        podName: 'pod-b',
        podUid: 'pod-uid-b',
      },
      {
        namespace: 'cpt-project-two',
        podName: 'pod-c',
        podUid: 'pod-uid-c',
      },
    ]);
    expect(metricsApi.requestedNamespaces).toEqual(['cpt-project', 'cpt-project-two']);
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
  public readonly requestedNamespaces: string[] = [];

  public constructor(private readonly items: PodMetric[]) {}

  public async getPodMetrics(namespace?: string): Promise<{ items: PodMetric[] }> {
    if (namespace === undefined) {
      throw new Error('Cluster-wide metrics requests are forbidden.');
    }
    this.requestedNamespaces.push(namespace);
    return await Promise.resolve({
      items: this.items.filter((item: PodMetric): boolean => item.metadata.namespace === namespace),
    });
  }
}

function productPod(
  name: string,
  uid: string,
  phase: 'Pending' | 'Running' | 'Succeeded' = 'Running',
  namespace: string = 'cpt-project',
): V1Pod {
  return {
    metadata: {
      labels: { 'app.kubernetes.io/managed-by': 'compartment', 'compartment.dev/deployment-id': 'dep-a' },
      name,
      namespace,
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

function podMetric(name: string, namespace: string = 'cpt-project'): PodMetric {
  return {
    containers: [{ name: 'app', usage: { cpu: '125m', memory: '64Mi' } }],
    metadata: {
      creationTimestamp: '2026-07-13T11:59:30.000Z',
      name,
      namespace,
      selfLink: `/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods/${name}`,
    },
    timestamp: '2026-07-13T12:00:00.000Z',
    window: '30s',
  };
}
