import type { PodMetric, V1Pod } from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';
import { readKubePodMetrics } from '../src/kube-pod-metrics';
import type {
  KubeNamespacedPodListInput,
  KubePodMetricCollection,
  KubePodListReader,
  KubePodMetricsReader,
} from '../src/kube-pod-metrics.types';

describe('Kubernetes Pod metrics observation', (): void => {
  it('keeps healthy namespace metrics when another namespace read fails', async (): Promise<void> => {
    const namespaceError: Error = new Error('metrics access denied');
    const result: KubePodMetricCollection = await readKubePodMetrics(
      new StubCoreApi([
        productPod('pod-a', 'pod-uid-a'),
        productPod('pod-b', 'pod-uid-b', 'Running', 'cpt-project-two'),
      ]),
      new FailingNamespaceMetricsApi([podMetric('pod-a')], 'cpt-project-two', namespaceError),
      {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
        namespaces: ['cpt-project', 'cpt-project-two'],
      },
    );

    expect(result).toMatchObject({
      failures: [{ namespace: 'cpt-project-two', reason: namespaceError }],
      observations: [{ namespace: 'cpt-project', podName: 'pod-a' }],
      successfulNamespaceCount: 1,
    });
  });

  it('joins metrics-server samples to product Pods by namespace and name', async (): Promise<void> => {
    const coreApi: StubCoreApi = new StubCoreApi([
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
        namespaces: ['cpt-project', 'cpt-project', 'cpt-project-two'],
      }),
    ).resolves.toMatchObject({
      failures: [],
      observations: [
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
      ],
      successfulNamespaceCount: 2,
    });
    expect(metricsApi.requestedNamespaces).toEqual(['cpt-project', 'cpt-project-two']);
    expect(coreApi.requestedNamespaces).toEqual(['cpt-project', 'cpt-project-two']);
  });

  it('treats a fresh product Pod without a metrics sample as transient', async (): Promise<void> => {
    const pod: V1Pod = productPod('pod-a', 'pod-uid-a');
    pod.metadata!.creationTimestamp = new Date(Date.now() - 60_000);

    await expect(
      readKubePodMetrics(new StubCoreApi([pod]), new StubMetricsApi([]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
        namespaces: ['cpt-project'],
      }),
    ).resolves.toMatchObject({
      failures: [],
      transientGaps: [
        {
          namespace: 'cpt-project',
          reason: new Error('metrics-server has not sampled a fresh product Pod yet.'),
        },
      ],
      observations: [],
      successfulNamespaceCount: 1,
    });
  });

  it('does not report an empty desired namespace as a snapshot failure', async (): Promise<void> => {
    await expect(
      readKubePodMetrics(new StubCoreApi([]), new StubMetricsApi([]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
        namespaces: ['cpt-project'],
      }),
    ).resolves.toMatchObject({
      failures: [],
      observations: [],
      successfulNamespaceCount: 1,
      transientGaps: [],
    });
  });

  it('keeps an old unsampled product Pod as a persistent namespace failure', async (): Promise<void> => {
    const pod: V1Pod = productPod('pod-a', 'pod-uid-a');
    pod.metadata!.creationTimestamp = new Date(Date.now() - 181_000);

    await expect(
      readKubePodMetrics(new StubCoreApi([pod]), new StubMetricsApi([]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
        namespaces: ['cpt-project'],
      }),
    ).resolves.toMatchObject({
      failures: [
        {
          namespace: 'cpt-project',
          reason: new Error('metrics-server returned an incomplete product Pod snapshot.'),
        },
      ],
      observations: [],
      successfulNamespaceCount: 0,
      transientGaps: [],
    });
  });

  it('keeps sampled live Pod metrics while another live Pod is waiting for its sample', async (): Promise<void> => {
    const sampledPod: V1Pod = productPod('pod-a', 'pod-uid-a', 'Running');
    const unsampledPod: V1Pod = productPod('pod-b', 'pod-uid-b', 'Pending');

    await expect(
      readKubePodMetrics(new StubCoreApi([sampledPod, unsampledPod]), new StubMetricsApi([podMetric('pod-a')]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
        namespaces: ['cpt-project'],
      }),
    ).resolves.toMatchObject({
      observations: [
        {
          deploymentId: 'dep-a',
          podName: 'pod-a',
          podUid: 'pod-uid-a',
        },
      ],
    });
  });

  it('reports an old unsampled Pod even when another Pod has a sample', async (): Promise<void> => {
    const sampledPod: V1Pod = productPod('pod-a', 'pod-uid-a', 'Running');
    const unsampledPod: V1Pod = productPod('pod-b', 'pod-uid-b', 'Running');
    unsampledPod.metadata!.creationTimestamp = new Date(Date.now() - 181_000);

    await expect(
      readKubePodMetrics(new StubCoreApi([sampledPod, unsampledPod]), new StubMetricsApi([podMetric('pod-a')]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
        namespaces: ['cpt-project'],
      }),
    ).resolves.toMatchObject({
      observations: [{ podName: 'pod-a' }],
      persistentGaps: [
        {
          namespace: 'cpt-project',
          reason: new Error('metrics-server is persistently missing product Pod samples.'),
        },
      ],
      successfulNamespaceCount: 1,
    });
  });

  it('keeps live Pod metrics when a completed release Job has no metrics-server sample', async (): Promise<void> => {
    const livePod: V1Pod = productPod('pod-a', 'pod-uid-a', 'Running');
    const completedJobPod: V1Pod = releaseJobPod('release-job-a', 'release-job-uid-a');

    await expect(
      readKubePodMetrics(new StubCoreApi([livePod, completedJobPod]), new StubMetricsApi([podMetric('pod-a')]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
        namespaces: ['cpt-project'],
      }),
    ).resolves.toMatchObject({
      observations: [
        {
          deploymentId: 'dep-a',
          podName: 'pod-a',
          podUid: 'pod-uid-a',
        },
      ],
    });
  });

  it('returns no observations when only a completed release Job Pod exists', async (): Promise<void> => {
    const completedJobPod: V1Pod = releaseJobPod('release-job-a', 'release-job-uid-a');

    await expect(
      readKubePodMetrics(new StubCoreApi([completedJobPod]), new StubMetricsApi([]), {
        kind: 'pod-metrics',
        labels: { 'app.kubernetes.io/managed-by': 'compartment' },
        namespaces: ['cpt-project'],
      }),
    ).resolves.toEqual({
      failures: [],
      observations: [],
      persistentGaps: [],
      successfulNamespaceCount: 1,
      transientGaps: [],
    });
  });
});

class StubCoreApi implements KubePodListReader {
  public readonly requestedNamespaces: string[] = [];

  public constructor(private readonly items: V1Pod[]) {}

  public async listNamespacedPod(input: KubeNamespacedPodListInput): Promise<{ items: V1Pod[] }> {
    this.requestedNamespaces.push(input.namespace);
    return await Promise.resolve({
      items: this.items.filter((item: V1Pod): boolean => item.metadata?.namespace === input.namespace),
    });
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

class FailingNamespaceMetricsApi extends StubMetricsApi {
  public constructor(
    items: PodMetric[],
    private readonly failingNamespace: string,
    private readonly error: Error,
  ) {
    super(items);
  }

  public override async getPodMetrics(namespace?: string): Promise<{ items: PodMetric[] }> {
    if (namespace === this.failingNamespace) {
      return await Promise.reject(this.error);
    }
    return await super.getPodMetrics(namespace);
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
