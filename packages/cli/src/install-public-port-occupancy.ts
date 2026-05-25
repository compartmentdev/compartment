import { createConnection, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';

interface InstallPublicPortConnectTarget {
  host: string;
}

const publicPortOccupancyProbeTimeoutMs: number = 200;

export async function isInstallPublicPortOccupied(port: number): Promise<boolean> {
  for (const connectTarget of readInstallPublicPortConnectTargets()) {
    if (await probeInstallPublicPortOccupancy(port, connectTarget)) {
      return true;
    }
  }

  return false;
}

function readInstallPublicPortConnectTargets(): InstallPublicPortConnectTarget[] {
  const hosts: Set<string> = new Set<string>(['127.0.0.1', '::1']);
  for (const interfaceAddresses of Object.values(networkInterfaces())) {
    for (const interfaceAddress of interfaceAddresses ?? []) {
      hosts.add(interfaceAddress.address);
    }
  }

  return [...hosts].map((host: string): InstallPublicPortConnectTarget => ({ host }));
}

async function probeInstallPublicPortOccupancy(
  port: number,
  connectTarget: InstallPublicPortConnectTarget,
): Promise<boolean> {
  return await new Promise<boolean>((resolve: (value: boolean) => void): void => {
    const socket: Socket = createConnection({ host: connectTarget.host, port });
    const settle: (occupied: boolean) => void = createInstallPublicPortOccupancyResolver(socket, resolve);
    configureInstallPublicPortOccupancySocket(socket);
    attachInstallPublicPortOccupancyListeners(socket, settle);
  });
}

function createInstallPublicPortOccupancyResolver(
  socket: Socket,
  resolve: (value: boolean) => void,
): (occupied: boolean) => void {
  let settled: boolean = false;

  return (occupied: boolean): void => {
    if (settled) {
      return;
    }

    settled = true;
    socket.destroy();
    resolve(occupied);
  };
}

function configureInstallPublicPortOccupancySocket(socket: Socket): void {
  socket.unref();
  socket.setTimeout(publicPortOccupancyProbeTimeoutMs);
}

function attachInstallPublicPortOccupancyListeners(socket: Socket, settle: (occupied: boolean) => void): void {
  socket.once('connect', (): void => {
    settle(true);
  });
  socket.once('error', (): void => {
    settle(false);
  });
  socket.once('timeout', (): void => {
    settle(false);
  });
}
