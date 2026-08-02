export interface RegistryInstallVerificationOutput {
  dockerConfigJson: string;
  imageRef: string;
}

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

export function retargetCompartmentArtifactImageDigestRef(
  registryAddress: string,
  imageRepository: string,
  imageRef: string,
): string | null {
  const repositoryDigestSuffix: string = `/${imageRepository}@`;
  const repositoryIndex: number = imageRef.lastIndexOf(repositoryDigestSuffix);
  if (repositoryIndex < 1) {
    return null;
  }
  const digest: string = imageRef.slice(repositoryIndex + repositoryDigestSuffix.length);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    return null;
  }
  return `${registryAddress}/${imageRepository}@${digest}`;
}
