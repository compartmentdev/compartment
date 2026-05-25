import { Socket } from 'node:net';
import {
  inspectDockerContainer,
  type DockerInspectContainerResult,
  type DockerNetworkAttachment,
} from '@compartment/docker';

export async function canConnectToRuntimeHost(host: string, port: number, deadline: number): Promise<boolean> {
  return await new Promise<boolean>((resolve: (value: boolean) => void): void => {
    const socket: Socket = new Socket();
    socket.setTimeout(Math.max(1, deadline - Date.now()));
    socket.once('connect', (): void => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (): void => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', (): void => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

export async function resolveRuntimeContainerNetworkHost(containerRef: string, networkName: string): Promise<string> {
  const container: DockerInspectContainerResult | null = await inspectDockerContainer({ containerRef });
  const networkAddress: string | null | undefined = container?.networkAttachments?.find(
    (attachment: DockerNetworkAttachment): boolean => attachment.name === networkName,
  )?.ipAddress;

  if (networkAddress === undefined || networkAddress === null || networkAddress === '') {
    throw new Error(`Container ${containerRef} is not attached to runtime network ${networkName} with an IP address.`);
  }

  return networkAddress;
}
