import { join, resolve } from 'node:path';
import { nodeResourceOperationBackupIdSchema } from '@compartment/contracts';
import { validateSymlinkFreeFileSystemEntry } from '@compartment/utils';

const resourceBackupBoundaryLabel: string = 'resource backup directory';
const resourceBackupArtifactLabel: string = 'Resource backup artifact directory';

export async function resolveRuntimeResourceBackupArtifactHostPath(
  backupId: string,
  resourceBackupDirectory: string,
): Promise<string> {
  const safeBackupId: string = nodeResourceOperationBackupIdSchema.parse(backupId);
  const backupRoot: string = resolve(resourceBackupDirectory);
  await assertResourceBackupRootDirectory(backupRoot);

  const artifactPath: string = join(backupRoot, safeBackupId);
  await validateSymlinkFreeFileSystemEntry({
    absolutePath: artifactPath,
    authoredPath: safeBackupId,
    boundaryDirectory: backupRoot,
    boundaryLabel: resourceBackupBoundaryLabel,
    expectedKind: 'directory',
    label: resourceBackupArtifactLabel,
    missingMessage: `${resourceBackupArtifactLabel} "${safeBackupId}" does not exist.`,
    relativeToLabel: resourceBackupBoundaryLabel,
  });

  return artifactPath;
}

async function assertResourceBackupRootDirectory(backupRoot: string): Promise<void> {
  await validateSymlinkFreeFileSystemEntry({
    absolutePath: backupRoot,
    authoredPath: '.',
    boundaryDirectory: backupRoot,
    boundaryLabel: resourceBackupBoundaryLabel,
    expectedKind: 'directory',
    label: 'Resource backup root directory',
  });
}
