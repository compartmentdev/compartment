import type { SelfHostedInstallPaths } from './self-hosted-install-paths.types';
import { basename, resolve } from 'node:path';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import { copySelfHostedPrivateFile, ensureSelfHostedPrivateDirectory } from './self-hosted-file-permissions';

export async function backupSelfHostedInstallFiles(installPaths: SelfHostedInstallPaths): Promise<string> {
  const backupDirectory: string = resolve(installPaths.backupRootDirectory, createBackupDirectoryName());

  await ensureSelfHostedPrivateDirectory(backupDirectory);
  await copySelfHostedPrivateFile(
    installPaths.stagedAssetPaths.envPath,
    resolveBackupFilePath(backupDirectory, installPaths.stagedAssetPaths.envPath),
  );
  await copyOptionalFile(
    installPaths.stagedAssetPaths.composePath,
    resolveBackupFilePath(backupDirectory, installPaths.stagedAssetPaths.composePath),
  );
  await copyOptionalFile(
    installPaths.stagedAssetPaths.localComposePath,
    resolveBackupFilePath(backupDirectory, installPaths.stagedAssetPaths.localComposePath),
  );
  await copyOptionalFile(installPaths.statePath, resolveBackupFilePath(backupDirectory, installPaths.statePath));

  return backupDirectory;
}

function createBackupDirectoryName(): string {
  return new Date().toISOString().replaceAll(':', '-');
}

async function copyOptionalFile(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await copySelfHostedPrivateFile(sourcePath, destinationPath);
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return;
    }

    throw error;
  }
}

function resolveBackupFilePath(backupDirectory: string, sourcePath: string): string {
  return resolve(backupDirectory, basename(sourcePath));
}
