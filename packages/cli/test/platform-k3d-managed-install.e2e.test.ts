import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import {
  cleanupManagedInstallFixture,
  managedInstallApiUrl,
  managedInstallBaseDomain,
  managedInstallBrokerUrl,
  managedInstallCertificateAuthorityPath,
  managedInstallKubeContext,
  managedInstallNamespace,
  managedInstallReleaseName,
  managedInstallValuesPath,
  prepareManagedInstallFixture,
  waitForManagedDomainBrokerObservation,
  type ManagedDomainAuditObservation,
  type ManagedDomainBrokerObservation,
} from './platform-k3d-managed-install.harness';

process.env.COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN = 'managed-install-reservation-token';

const platformModeEnvName: string = 'COMPARTMENT_E2E_PLATFORM_MODE';
const ciEnvironmentName: string = 'CI';
const organizationName: string = 'Managed Platform E2E';
const organizationSlug: string = 'managed-platform-e2e';
const installTimeoutMs: number = 50 * 60_000;
const fixtureTimeoutMs: number = 10 * 60_000;
const tempRootDirectory: string = readSocketSafeTempRootDirectory('pk3m-', 'system-api.sock');
const createdDirectories: string[] = [];
const managedIngressIpv4: string = [8, 8, 4, 4].join('.');
let managedInstallCompleted: boolean = false;

describe.sequential('production managed-domain Kubernetes install', (): void => {
  if (process.env[platformModeEnvName] !== 'k3d') {
    it(`requires ${platformModeEnvName}=k3d`, (): void => {
      expect(process.env[platformModeEnvName]).toBe('k3d');
    });
    return;
  }

  beforeAll(async (): Promise<void> => {
    await assertBuiltCliAvailable();
    await prepareManagedInstallFixture();
  }, fixtureTimeoutMs);
  afterAll(async (): Promise<void> => {
    if (managedInstallCompleted || process.env[ciEnvironmentName] !== 'true') {
      await cleanupManagedInstallFixture();
    }
    await Promise.all(
      createdDirectories
        .splice(0)
        .map(async (directory: string): Promise<void> => await rm(directory, { force: true, recursive: true })),
    );
  }, fixtureTimeoutMs);

  it(
    'allocates a domain through shared Ingress, bootstraps the owner, and accepts a fresh login',
    async (): Promise<void> => {
      const suffix: string = randomUUID().replaceAll('-', '').slice(0, 12);
      const ownerEmail: string = `managed-e2e-${suffix}@compartment.test`;
      const ownerPassword: string = `ManagedE2e-${randomBytes(24).toString('base64url')}!`;
      const installerCli: SelfHostedUserSetupCli = await createFreshCli(ownerPassword);
      const result: InstallResponse = await installerCli.runJson(
        `install --api-url ${managedInstallApiUrl} --broker-url ${managedInstallBrokerUrl} --values ${managedInstallValuesPath} --kube-context ${managedInstallKubeContext} --namespace ${managedInstallNamespace} --release-name ${managedInstallReleaseName} --email ${ownerEmail} --organization "${organizationName}" --organization-slug ${organizationSlug}`,
        installResponseSchema,
      );

      expect(result.adminEmail).toBe(ownerEmail);
      expect(result.compartmentUrl).toBe(`https://console.${managedInstallBaseDomain}`);
      expect(result.organization.slug).toBe(organizationSlug);

      const installedIdentity: WhoAmICommandResponse = await installerCli.runJson(
        'whoami',
        whoamiCommandResponseSchema,
      );
      expect(installedIdentity.principal.email).toBe(ownerEmail);

      const freshCli: SelfHostedUserSetupCli = await createFreshCli();
      const certificateAuthority: Buffer = await readFile(managedInstallCertificateAuthorityPath);
      await freshCli.runBrowserLogin(
        `login --output json --api-url ${managedInstallApiUrl} --email ${ownerEmail}`,
        { email: ownerEmail, password: ownerPassword },
        { certificateAuthority, requestOrigin: managedInstallApiUrl },
      );
      const freshIdentity: WhoAmICommandResponse = await freshCli.runJson('whoami', whoamiCommandResponseSchema);
      expect(freshIdentity.principal.email).toBe(ownerEmail);
      expect(freshIdentity.currentOrganization?.slug).toBe(organizationSlug);

      const broker: ManagedDomainBrokerObservation = await waitForManagedDomainBrokerObservation();
      expect(broker.allocations[0]).toMatchObject({
        requestedLabelSource: organizationSlug,
        targets: [{ type: 'A', value: managedIngressIpv4 }],
      });
      expect(
        broker.audit.some((event: ManagedDomainAuditObservation): boolean => event.event === 'challenge_presented'),
      ).toBe(true);
      expect(
        broker.audit.some((event: ManagedDomainAuditObservation): boolean => event.event === 'challenge_cleaned'),
      ).toBe(true);
      managedInstallCompleted = true;
    },
    installTimeoutMs,
  );
});

async function createFreshCli(adminPassword?: string): Promise<SelfHostedUserSetupCli> {
  const homeDirectory: string = await mkdtemp(join(tempRootDirectory, 'client-'));
  createdDirectories.push(homeDirectory);
  const env: NodeJS.ProcessEnv = buildSelfHostedUserSetupClientEnv(homeDirectory);
  env.NODE_EXTRA_CA_CERTS = managedInstallCertificateAuthorityPath;
  if (adminPassword !== undefined) {
    env.COMPARTMENT_ADMIN_PASSWORD = adminPassword;
  }
  return new SelfHostedUserSetupCli(env, installTimeoutMs);
}
