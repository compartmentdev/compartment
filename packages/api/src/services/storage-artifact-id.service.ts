const UNSAFE_STORAGE_ARTIFACT_ID_PATTERN: RegExp = /[^a-zA-Z0-9_-]/g;

export function sanitizeStorageArtifactId(artifactId: string): string {
  return artifactId.replace(UNSAFE_STORAGE_ARTIFACT_ID_PATTERN, '_');
}
