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

export function requireRailpackSecretsFingerprint(
  buildEnv: Record<string, string> | undefined,
  fingerprint: string | undefined,
): string | null {
  if (buildEnv === undefined || Object.keys(buildEnv).length === 0) {
    return null;
  }
  if (fingerprint === undefined || !isKeyedSha256Fingerprint(fingerprint)) {
    throw new Error('A keyed build secret fingerprint is required when build secrets are present.');
  }
  return fingerprint;
}

export function isKeyedSha256Fingerprint(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function compareBuildEnvEntries(left: [string, string], right: [string, string]): number {
  return left[0].localeCompare(right[0]);
}
