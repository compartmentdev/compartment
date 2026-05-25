import { relative, resolve } from 'node:path';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { listDirectoryLineage, pathExists } from './directory-lineage.service';

export async function findGitRepositoryRoot(startDirectory: string): Promise<string | undefined> {
  const normalizedDirectory: string = resolve(startDirectory);
  for (const directory of listDirectoryLineage(normalizedDirectory)) {
    if (await pathExists(resolve(directory, '.git'))) {
      return directory;
    }
  }

  return undefined;
}

export async function isGitTrackedFile(repositoryRoot: string, filePath: string): Promise<boolean> {
  const relativePath: string = toRepositoryRelativePath(repositoryRoot, filePath);
  if (relativePath === '' || relativePath.startsWith('..')) {
    return false;
  }

  const result: CommandResult = await runCommand(
    ['git', '-C', repositoryRoot, 'ls-files', '--error-unmatch', '--', relativePath],
    process.env,
  );
  return result.exitCode === 0;
}

export function toRepositoryRelativePath(repositoryRoot: string, targetPath: string): string {
  const value: string = relative(repositoryRoot, targetPath).replaceAll('\\', '/');
  return value === '' ? '.' : value;
}
