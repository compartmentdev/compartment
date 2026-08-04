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
  const digest: string | null = readCompartmentArtifactImageDigest(imageRef);
  if (digest === null) {
    return null;
  }
  return `${registryAddress}/${imageRepository}@${digest}`;
}

export function readCompartmentArtifactImageDigest(imageRef: string): string | null {
  const digest: string | undefined = /@(sha256:[a-f0-9]{64})$/u.exec(imageRef)?.[1];
  return digest ?? null;
}
