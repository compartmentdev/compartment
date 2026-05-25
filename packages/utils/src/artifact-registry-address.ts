export function buildCompartmentArtifactRegistryAddress(host: string, port: number): string {
  return `${host}:${port.toString()}`;
}
