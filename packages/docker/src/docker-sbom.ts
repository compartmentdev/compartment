import { createHash } from 'node:crypto';
import { execa } from 'execa';
import { withDockerRegistryAuthConfig } from './docker-registry-auth-config';
import type { DockerRegistryCredentials } from './docker-models';
import type { DockerSbom } from './docker-sbom.types';

export async function scanDockerImageSbom(
  imageRef: string,
  credentials: DockerRegistryCredentials,
  insecureRegistry: boolean,
): Promise<DockerSbom> {
  return await withDockerRegistryAuthConfig(
    credentials,
    async (authEnv: Record<string, string>): Promise<DockerSbom> => {
      const { stdout } = await execa('syft', ['scan', `registry:${imageRef}`, '--output', 'syft-json'], {
        extendEnv: false,
        env: {
          ...authEnv,
          PATH: '/usr/local/bin:/usr/bin:/bin',
          ...(insecureRegistry ? { SYFT_REGISTRY_INSECURE_USE_HTTP: 'true' } : {}),
        },
      });
      const json: string = `${stdout}\n`;
      JSON.parse(json);
      return {
        digest: `sha256:${createHash('sha256').update(json).digest('hex')}`,
        json,
      };
    },
  );
}
