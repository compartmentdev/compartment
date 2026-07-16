import { findFreePort } from '@compartment/test-support';

type DistinctFreePorts = readonly [number, number];

export async function findDistinctFreePorts(): Promise<DistinctFreePorts> {
  const publicHttpPort: number = await findFreePort();
  const publicHttpsPort: number = await findFreePortExcluding([publicHttpPort]);

  return [publicHttpPort, publicHttpsPort];
}

export async function findFreePortExcluding(excludedPorts: readonly number[]): Promise<number> {
  for (;;) {
    const port: number = await findFreePort();
    if (!excludedPorts.includes(port)) {
      return port;
    }
  }
}
