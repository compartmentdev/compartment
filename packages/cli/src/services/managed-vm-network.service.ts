const managedVmRequiredEndpoints: readonly string[] = [
  'https://compartment.dev/install.sh',
  'https://github.com',
  'https://ghcr.io/v2/',
  'https://registry-1.docker.io/v2/',
  'https://get.helm.sh',
  'https://storage.googleapis.com/gvisor/releases/',
  'https://acme-v02.api.letsencrypt.org/directory',
  'https://broker.compartment.run',
];

export const managedVmRequiredEndpointCount: number = managedVmRequiredEndpoints.length;

export async function readReachableManagedVmEndpoints(): Promise<readonly string[]> {
  const results: (string | undefined)[] = await Promise.all(
    managedVmRequiredEndpoints.map(async (url: string): Promise<string | undefined> => await endpointIfReachable(url)),
  );
  return results.filter((url: string | undefined): url is string => url !== undefined);
}

async function endpointIfReachable(url: string): Promise<string | undefined> {
  try {
    const response: Response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
    return response.status < 500 ? url : undefined;
  } catch {
    return undefined;
  }
}
