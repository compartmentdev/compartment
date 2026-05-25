import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DockerRegistryCredentials } from './docker-models';

interface DockerAuthConfig {
  auths: Record<string, DockerAuthConfigEntry>;
}

interface DockerAuthConfigEntry {
  auth: string;
}

type DockerRegistryAuthCallback<TResult> = (env: Record<string, string>) => Promise<TResult>;

export async function withDockerRegistryAuthConfig<TResult>(
  credentials: DockerRegistryCredentials | undefined,
  callback: DockerRegistryAuthCallback<TResult>,
): Promise<TResult> {
  if (credentials === undefined) {
    return await callback({});
  }

  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-docker-auth-'));
  try {
    await writeFile(join(directory, 'config.json'), `${JSON.stringify(buildDockerAuthConfig(credentials))}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return await callback({ DOCKER_CONFIG: directory });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function buildDockerAuthConfig(credentials: DockerRegistryCredentials): DockerAuthConfig {
  return {
    auths: {
      [credentials.serverAddress]: {
        auth: Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64'),
      },
    },
  };
}
