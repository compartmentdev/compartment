export function buildCompartmentArtifactImageRepository(projectId: string, serviceId: string): string {
  return `projects/${projectId}/services/${serviceId}`;
}

export function buildCompartmentArtifactImageTag(
  registryAddress: string,
  imageRepository: string,
  artifactId: string,
): string {
  return `${registryAddress}/${imageRepository}:${artifactId}`;
}
