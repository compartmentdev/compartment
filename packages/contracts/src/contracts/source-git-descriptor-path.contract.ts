import { normalizeRepositoryRelativePath } from './repository-relative-path.contract';

export function readGitSourceDescriptorProjectMismatchMessage(
  descriptorPath: string,
  actualProjectName: string,
  expectedProjectName: string,
): string {
  return `Descriptor ${descriptorPath} declares project "${actualProjectName}", not "${expectedProjectName}".`;
}

export function readGitSourceDescriptorDirectory(descriptorPath: string): string {
  const segments: string[] = normalizeRepositoryRelativePath(descriptorPath).split('/').slice(0, -1);
  return segments.length === 0 ? '.' : segments.join('/');
}
