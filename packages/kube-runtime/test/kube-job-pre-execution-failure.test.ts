import type { CoreV1Api, CoreV1Event, CoreV1EventList } from '@kubernetes/client-node';
import { describe, expect, it, type Mock, vi } from 'vitest';
import { readPreExecutionFailure } from '../src/kube-job-pre-execution-failure';
import type { KubeJobImageVolume } from '../src/kube-job-spec.types';

const seedReference: string = 'cache.example/seed@sha256:abc';
const imageVolumes: KubeJobImageVolume[] = [{ name: 'seed', pullPolicy: 'IfNotPresent', reference: seedReference }];

describe('Job pre-execution failure evidence', (): void => {
  it('identifies a FailedMount event that names the selected image-volume reference', async (): Promise<void> => {
    await expect(
      readPreExecutionFailure(coreApi(event('FailedMount', seedReference)), 'builds', ['job-pod'], imageVolumes),
    ).resolves.toBe('image-pull');
  });

  it('does not classify unrelated pod events as seed pull failures', async (): Promise<void> => {
    await expect(
      readPreExecutionFailure(coreApi(event('FailedScheduling', seedReference)), 'builds', ['job-pod'], imageVolumes),
    ).resolves.toBeUndefined();
    await expect(
      readPreExecutionFailure(
        coreApi(event('FailedMount', 'cache.example/other@sha256:def')),
        'builds',
        ['job-pod'],
        imageVolumes,
      ),
    ).resolves.toBeUndefined();
  });
});

function coreApi(value: CoreV1Event): CoreV1Api {
  const listNamespacedEvent: Mock = vi.fn(
    async (): Promise<CoreV1EventList> => await Promise.resolve({ items: [value] }),
  );
  const fixture: Pick<CoreV1Api, 'listNamespacedEvent'> = { listNamespacedEvent };
  return fixture as CoreV1Api;
}

function event(reason: string, reference: string): CoreV1Event {
  return {
    involvedObject: {},
    message: `MountVolume.SetUp failed: failed to pull image ${reference}`,
    metadata: {},
    reason,
  };
}
