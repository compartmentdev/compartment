import { readFile } from 'node:fs/promises';
import { readSelfHostedEnvironmentValues } from './self-hosted-env-file';
import { ensureSelfHostedRuntimeDirectories } from './self-hosted-runtime-directories';

interface EnsureSelfHostedRuntimeDirectoriesFromEnvFileInput {
  readonly envPath: string;
  readonly repairRuntimeWritableDirectoryContents: boolean;
}

export async function ensureSelfHostedRuntimeDirectoriesFromEnvFile(
  input: EnsureSelfHostedRuntimeDirectoriesFromEnvFileInput,
): Promise<void> {
  const environmentText: string = await readFile(input.envPath, 'utf8');
  await ensureSelfHostedRuntimeDirectories({
    environmentValues: readSelfHostedEnvironmentValues(environmentText),
    repairRuntimeWritableDirectoryContents: input.repairRuntimeWritableDirectoryContents,
  });
}
