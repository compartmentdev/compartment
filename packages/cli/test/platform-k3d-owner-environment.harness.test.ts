import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  platformK3dOwnerEnvironmentPath,
  publishPlatformK3dOwnerEnvironment,
} from './platform-k3d-owner-environment.harness';

const createdDirectories: string[] = [];

describe('platform k3d owner environment harness', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      createdDirectories
        .splice(0)
        .map(async (directory: string): Promise<void> => await rm(directory, { force: true, recursive: true })),
    );
  });

  it('owns the durable owner environment at the repository root regardless of package cwd', (): void => {
    expect(platformK3dOwnerEnvironmentPath).toBe(
      resolve(__dirname, '../../..', '.compartment/platform-k3d-e2e-owner.env'),
    );
  });

  it('persists the installed owner when GitHub Actions environment publishing is unavailable', async (): Promise<void> => {
    const directory: string = await createTempDirectory();
    const statePath: string = join(directory, 'state', 'owner.env');
    const env: NodeJS.ProcessEnv = {};

    await publishPlatformK3dOwnerEnvironment('owner@example.com', 'owner-password', statePath, env);

    expect(env.COMPARTMENT_E2E_SEED_ADMIN_EMAIL).toBe('owner@example.com');
    expect(env.COMPARTMENT_E2E_SEED_ADMIN_PASSWORD).toBe('owner-password');
    await expect(readFile(statePath, 'utf8')).resolves.toBe(
      'COMPARTMENT_E2E_SEED_ADMIN_EMAIL=owner@example.com\n' + 'COMPARTMENT_E2E_SEED_ADMIN_PASSWORD=owner-password\n',
    );
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);
  });

  it('also publishes the installed owner to subsequent GitHub Actions steps', async (): Promise<void> => {
    const directory: string = await createTempDirectory();
    const statePath: string = join(directory, 'state', 'owner.env');
    const githubEnvPath: string = join(directory, 'github.env');
    const env: NodeJS.ProcessEnv = { GITHUB_ENV: githubEnvPath };

    await publishPlatformK3dOwnerEnvironment('owner@example.com', 'owner-password', statePath, env);

    await expect(readFile(githubEnvPath, 'utf8')).resolves.toBe(
      'COMPARTMENT_E2E_SEED_ADMIN_EMAIL=owner@example.com\n' + 'COMPARTMENT_E2E_SEED_ADMIN_PASSWORD=owner-password\n',
    );
  });
});

async function createTempDirectory(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'platform-k3d-owner-env-'));
  createdDirectories.push(directory);
  return directory;
}
