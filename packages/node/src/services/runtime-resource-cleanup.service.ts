import { removeDockerContainer } from '@compartment/docker';

export async function removeRuntimeResourceContainerBestEffort(containerRef: string): Promise<void> {
  try {
    await removeDockerContainer({ containerRef });
  } catch {
    return;
  }
}
