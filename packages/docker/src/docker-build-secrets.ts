import { createHash, type Hash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RailpackSecretFile {
  keyName: string;
  path: string;
}

export async function writeRailpackSecretFiles(
  railpackDirectory: string,
  buildEnv: Record<string, string> | undefined,
): Promise<RailpackSecretFile[]> {
  const entries: [string, string][] = Object.entries(buildEnv ?? {}).sort(compareBuildEnvEntries);
  const secretFiles: RailpackSecretFile[] = [];

  for (const [index, [keyName, value]] of entries.entries()) {
    const path: string = join(railpackDirectory, `build-secret-${index}.txt`);
    await writeFile(path, value);
    secretFiles.push({
      keyName,
      path,
    });
  }

  return secretFiles;
}

export function buildRailpackSecretArgs(secretFiles: readonly RailpackSecretFile[]): string[] {
  return secretFiles.flatMap((secretFile: RailpackSecretFile): string[] => [
    '--secret',
    `id=${secretFile.keyName},src=${secretFile.path}`,
  ]);
}

export function buildRailpackSecretsHash(buildEnv: Record<string, string> | undefined): string | null {
  if (buildEnv === undefined || Object.keys(buildEnv).length === 0) {
    return null;
  }

  const hash: Hash = createHash('sha256');

  for (const [name, value] of Object.entries(buildEnv).sort(compareBuildEnvEntries)) {
    hash.update(name);
    hash.update('\0');
    hash.update(value);
    hash.update('\0');
  }

  return hash.digest('hex');
}

function compareBuildEnvEntries(left: [string, string], right: [string, string]): number {
  return left[0].localeCompare(right[0]);
}
