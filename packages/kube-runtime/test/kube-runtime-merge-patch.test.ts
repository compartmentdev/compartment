import { KubernetesObjectApi, PatchStrategy } from '@kubernetes/client-node';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { KubeRuntime, type KubeManifest } from '../src';

interface PatchApi {
  patch: Mock;
}

describe('KubeRuntime merge patch', (): void => {
  const api: PatchApi = { patch: vi.fn() };
  const namespace: KubeManifest = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { labels: { 'compartment.dev/organization-id': 'org_1' }, name: 'cpt-prj_1' },
  };

  beforeEach((): void => {
    vi.restoreAllMocks();
    api.patch.mockReset();
    vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue(api as never);
  });

  it('merge-patches existing metadata without creating a missing object', async (): Promise<void> => {
    api.patch.mockResolvedValueOnce(namespace);
    const runtime: KubeRuntime = new KubeRuntime({ makeApiClient: (): object => ({}) } as never);

    await expect(runtime.mergePatchExisting(namespace)).resolves.toEqual(namespace);
    expect(api.patch).toHaveBeenCalledWith(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      PatchStrategy.MergePatch,
    );
    api.patch.mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 404 }));
    await expect(runtime.mergePatchExisting(namespace)).resolves.toBeNull();
  });
});
