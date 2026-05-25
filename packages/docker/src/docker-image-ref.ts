export function readDockerImageRepository(imageTag: string): string {
  const lastSlashIndex: number = imageTag.lastIndexOf('/');
  const lastColonIndex: number = imageTag.lastIndexOf(':');
  if (lastColonIndex <= lastSlashIndex) {
    throw new Error(`Expected docker image tag "${imageTag}" to include a tag suffix.`);
  }

  return imageTag.slice(0, lastColonIndex);
}
