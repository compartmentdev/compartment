import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  installResponseSchema,
  whoamiCommandResponseSchema,
  type InstallResponse,
  type WhoAmICommandResponse,
} from '@compartment/contracts';
import { readSocketSafeTempRootDirectory } from '@compartment/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertBuiltCliAvailable } from './self-hosted-user-setup-command.harness';
import { buildSelfHostedUserSetupClientEnv } from './self-hosted-user-setup-client-env.harness';
import { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { publishPlatformK3dOwnerEnvironment } from './platform-k3d-owner-environment.harness';

const platformModeEnvName: string = 'COMPARTMENT_E2E_PLATFORM_MODE';
const platformApiUrl: string = 'http://console.compartment.localhost:18080';
const platformCompartmentUrl: string = 'http://console.compartment.localhost';
const platformBaseDomain: string = 'compartment.localhost';
const platformOrganizationName: string = 'Platform E2E';
const platformOrganizationSlug: string = 'platform-e2e';
const platformValuesPath: string = '.compartment/platform-k3d-e2e-values.yaml';
const platformKubeContext: string = 'k3d-compartment-e2e';
const platformNamespace: string = 'compartment';
const installTimeoutMs: number = 50 * 60_000;
const tempRootDirectory: string = readSocketSafeTempRootDirectory('pk3i-', 'system-api.sock');
const createdDirectories: string[] = [];

describe.sequential('production Kubernetes install', (): void => {
  if (process.env[platformModeEnvName] !== 'k3d') {
    it(`requires ${platformModeEnvName}=k3d`, (): void => {
      expect(process.env[platformModeEnvName]).toBe('k3d');
    });
    return;
  }

  beforeAll(async (): Promise<void> => await assertBuiltCliAvailable());
  afterAll(async (): Promise<void> => {
    await Promise.all(
      createdDirectories
        .splice(0)
        .map(async (directory: string): Promise<void> => await rm(directory, { force: true, recursive: true })),
    );
  });

  it(
    'installs an uninitialized platform, persists the owner session, and accepts a fresh password login',
    async (): Promise<void> => {
      const suffix: string = randomUUID().replaceAll('-', '').slice(0, 12);
      const ownerEmail: string = `platform-e2e-${suffix}@compartment.test`;
      const ownerPassword: string = `PlatformE2e-${randomBytes(24).toString('base64url')}!`;
      const installerCli: SelfHostedUserSetupCli = await createFreshCli();
      const result: InstallResponse = await installerCli.runJson(
        `install --api-url ${platformApiUrl} --base-domain ${platformBaseDomain} --values ${platformValuesPath} --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name compartment --email ${ownerEmail} --organization "${platformOrganizationName}" --organization-slug ${platformOrganizationSlug}`,
        installResponseSchema,
        { input: `${ownerPassword}\n${ownerPassword}\n` },
      );

      expect(result.adminEmail).toBe(ownerEmail);
      expect(result.compartmentUrl).toBe(platformCompartmentUrl);
      expect(result.organization.slug).toBe(platformOrganizationSlug);
      await publishPlatformK3dOwnerEnvironment(ownerEmail, ownerPassword);

      const installedIdentity: WhoAmICommandResponse = await installerCli.runJson(
        'whoami',
        whoamiCommandResponseSchema,
      );
      expect(installedIdentity.principal.email).toBe(ownerEmail);
      expect(installedIdentity.currentOrganization?.slug).toBe(platformOrganizationSlug);

      const freshCli: SelfHostedUserSetupCli = await createFreshCli();
      await freshCli.runBrowserLogin(
        `login --api-url ${platformApiUrl} --email ${ownerEmail} --output json`,
        { email: ownerEmail, password: ownerPassword },
        { requestOrigin: platformApiUrl },
      );
      const freshIdentity: WhoAmICommandResponse = await freshCli.runJson('whoami', whoamiCommandResponseSchema);
      expect(freshIdentity.principal.email).toBe(ownerEmail);
      expect(freshIdentity.currentOrganization?.slug).toBe(platformOrganizationSlug);
    },
    installTimeoutMs,
  );
});

async function createFreshCli(): Promise<SelfHostedUserSetupCli> {
  const homeDirectory: string = await mkdtemp(join(tempRootDirectory, 'client-'));
  createdDirectories.push(homeDirectory);
  return new SelfHostedUserSetupCli(buildSelfHostedUserSetupClientEnv(homeDirectory), installTimeoutMs);
}
