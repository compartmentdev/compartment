import { KubernetesObjectApi } from '@kubernetes/client-node';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { KubeRuntime, type KubeManifest } from '../src';
import { CapturingKubernetesObjectApi } from './kube-transport-capture.harness';

describe('workload deletion', (): void => {
  const deleteObject: Mock = vi.fn(async (): Promise<object> => await Promise.resolve({}));

  beforeEach((): void => {
    vi.restoreAllMocks();
    deleteObject.mockReset();
    deleteObject.mockResolvedValue({});
    vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue({ delete: deleteObject } as never);
  });

  it.each(['Deployment', 'ReplicaSet'] as const)(
    'deletes %s objects with foreground cascading and treats absence as converged',
    async (kind: 'Deployment' | 'ReplicaSet'): Promise<void> => {
      const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): object => ({}) } as never);
      const object: KubeManifest = {
        apiVersion: 'apps/v1',
        kind,
        metadata: { name: 'candidate', namespace: 'cpt-project' },
      };

      await runtime.delete([object]);
      expect(deleteObject).toHaveBeenCalledWith(
        object,
        undefined,
        undefined,
        undefined,
        undefined,
        'Foreground',
        undefined,
      );

      deleteObject.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
      await expect(runtime.delete([object])).resolves.toBeUndefined();
    },
  );

  it('serializes candidate Deployment deletion with foreground cascading', async (): Promise<void> => {
    const objectApi = new CapturingKubernetesObjectApi('/apis/apps/v1/namespaces/cpt-project/deployments/candidate');
    vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue(objectApi);
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): object => ({}) } as never);

    await runtime.delete([
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'candidate', namespace: 'cpt-project' },
      },
    ]);

    expect(objectApi.method).toBe('DELETE');
    expect(objectApi.url).toBe(
      'https://kubernetes.test/apis/apps/v1/namespaces/cpt-project/deployments/candidate?propagationPolicy=Foreground',
    );
    expect(objectApi.body).toBeNull();
  });
});
