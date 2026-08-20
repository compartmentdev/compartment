import type { CoreV1Api, CoreV1Event, CoreV1EventList } from '@kubernetes/client-node';
import type { KubeJobImageVolume } from './kube-job-spec.types';

export async function readPreExecutionFailure(
  coreApi: CoreV1Api,
  namespace: string,
  podNames: readonly string[],
  imageVolumes: KubeJobImageVolume[] | undefined,
): Promise<'evidence-unavailable' | 'image-pull' | undefined> {
  const references: readonly string[] =
    imageVolumes?.map((volume: KubeJobImageVolume): string => volume.reference) ?? [];
  if (references.length === 0 || podNames.length === 0) {
    return undefined;
  }
  let events: CoreV1Event[];
  try {
    events = (
      await Promise.all(
        podNames.map(
          async (podName: string): Promise<CoreV1Event[]> => await readPodEvents(coreApi, namespace, podName),
        ),
      )
    ).flat();
  } catch {
    return 'evidence-unavailable';
  }
  return events.some((event: CoreV1Event): boolean => isImageVolumePullFailure(event, references))
    ? 'image-pull'
    : undefined;
}

async function readPodEvents(coreApi: CoreV1Api, namespace: string, podName: string): Promise<CoreV1Event[]> {
  const response: CoreV1EventList = await coreApi.listNamespacedEvent({
    fieldSelector: `involvedObject.kind=Pod,involvedObject.name=${podName}`,
    namespace,
  });
  return response.items;
}

function isImageVolumePullFailure(event: CoreV1Event, references: readonly string[]): boolean {
  return (
    event.reason === 'FailedMount' &&
    references.some((reference: string): boolean => event.message?.includes(reference) === true)
  );
}
