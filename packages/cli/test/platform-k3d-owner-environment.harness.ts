import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ownerEmailEnvName: string = 'COMPARTMENT_E2E_SEED_ADMIN_EMAIL';
const ownerSecretEnvName: string = 'COMPARTMENT_E2E_SEED_ADMIN_PASSWORD';
export const platformK3dOwnerEnvironmentPath: string = resolve(
  __dirname,
  '../../..',
  process.env.COMPARTMENT_E2E_OWNER_ENV_PATH ?? '.compartment/platform-k3d-e2e-owner.env',
);

export async function publishPlatformK3dOwnerEnvironment(
  ownerEmail: string,
  ownerPassword: string,
  statePath: string = platformK3dOwnerEnvironmentPath,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const content: string = `${ownerEmailEnvName}=${ownerEmail}\n${ownerSecretEnvName}=${ownerPassword}\n`;

  env[ownerEmailEnvName] = ownerEmail;
  env[ownerSecretEnvName] = ownerPassword;

  await mkdir(dirname(statePath), { mode: 0o700, recursive: true });
  await writeFile(statePath, content, { mode: 0o600 });

  const githubEnvPath: string = env.GITHUB_ENV?.trim() ?? '';
  if (githubEnvPath !== '') {
    await appendFile(githubEnvPath, content, { mode: 0o600 });
  }
}
