import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readSocketSafeTempRootDirectory } from '@compartment/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSelfHostedUserSetupAppFixture,
  type SelfHostedUserSetupAppFixture,
  type SelfHostedUserSetupAppFixtureOptions,
} from './self-hosted-user-setup-app-fixture';
import { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { buildSelfHostedUserSetupClientEnv } from './self-hosted-user-setup-client-env.harness';
import { assertBuiltCliAvailable, runTimedStep } from './self-hosted-user-setup-command.harness';
import {
  configureK3dTrustedOutboundHosts,
  provisionK3dSuiteOrganization,
  readK3dPlatformSeed,
  type K3dPlatformSeed,
  type K3dSuiteOrganizationCredentials,
} from './self-hosted-user-setup-k3d.harness';

export interface SelfHostedUserSetupRuntime {
  readonly adminEmail: string;
  readonly adminPassword: string;
  readonly apiUrl: string;
  readonly compartmentUrl: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
}

export interface SelfHostedUserSetupHarness {
  createAppFixture(options?: SelfHostedUserSetupAppFixtureOptions): Promise<SelfHostedUserSetupAppFixture>;
  createFreshCli(): Promise<SelfHostedUserSetupCli>;
  install(): Promise<SelfHostedUserSetupRuntime>;
}

const e2eEnabledEnvName: string = 'COMPARTMENT_SELF_HOSTED_USER_SETUP_E2E';
const tempRootDirectory: string = readSocketSafeTempRootDirectory('ouse-', 'system-api.sock');
const clientCommandTimeoutMs: number = process.env.COMPARTMENT_E2E_GVISOR_ENABLED === '1' ? 30 * 60_000 : 10 * 60_000;
export const selfHostedUserSetupTimeoutMs: number = 25 * 60_000;

export function describeSelfHostedUserSetupE2e(name: string, factory: () => void): void {
  describe.sequential(name, (): void => {
    if (process.env[e2eEnabledEnvName] !== '1') {
      it(`requires ${e2eEnabledEnvName}=1`, (): void => {
        expect(process.env[e2eEnabledEnvName]).toBe('1');
      });
      return;
    }
    factory();
  });
}

export function buildSelfHostedAppHostname(
  runtime: SelfHostedUserSetupRuntime,
  projectName: string,
  serviceName: string = 'web',
): string {
  const controlPlaneHostname: string = new URL(runtime.compartmentUrl).hostname;
  if (!controlPlaneHostname.startsWith('console.')) {
    throw new Error(`Expected control-plane host ${controlPlaneHostname} to start with console.`);
  }
  const appPrefix: string = serviceName === 'web' ? projectName : `${serviceName}-${projectName}`;
  return `${appPrefix}.${controlPlaneHostname.slice('console.'.length)}`;
}

export function buildSelfHostedAdvertisedCompartmentUrl(compartmentConnectUrl: string): string {
  const advertisedCompartmentUrl: URL = new URL(compartmentConnectUrl);
  advertisedCompartmentUrl.port = '';

  return advertisedCompartmentUrl.origin;
}

export function expectSelfHostedUserSetupStepCompleted(completedStepCount: number, requiredStepCount: number): void {
  expect(completedStepCount, `Expected e2e step ${requiredStepCount.toString()} to complete.`).toBeGreaterThanOrEqual(
    requiredStepCount,
  );
}

export async function configureSelfHostedTrustedOutboundHosts(hosts: readonly string[]): Promise<void> {
  const trustedHostList: string = hosts.join(',');
  if (/[\n\r]/u.test(trustedHostList)) {
    throw new Error('Trusted outbound host test fixture must not contain control characters.');
  }
  await configureK3dTrustedOutboundHosts(trustedHostList);
}

export function useSelfHostedUserSetupHarness(): SelfHostedUserSetupHarness {
  const harness: SelfHostedUserSetupHarnessHandle = new SelfHostedUserSetupHarnessHandle();
  beforeAll(async (): Promise<void> => await harness.setup(), selfHostedUserSetupTimeoutMs);
  afterAll(async (): Promise<void> => await harness.cleanup(), selfHostedUserSetupTimeoutMs);
  return harness;
}

class SelfHostedUserSetupHarnessHandle implements SelfHostedUserSetupHarness {
  readonly #appFixtureDirectories: string[] = [];
  readonly #clientHomeDirectories: string[] = [];

  async setup(): Promise<void> {
    await assertBuiltCliAvailable();
    readK3dPlatformSeed();
  }

  async cleanup(): Promise<void> {
    for (const directory of [...this.#clientHomeDirectories, ...this.#appFixtureDirectories]) {
      await rm(directory, { force: true, recursive: true });
    }
    this.#clientHomeDirectories.length = 0;
    this.#appFixtureDirectories.length = 0;
  }

  async install(): Promise<SelfHostedUserSetupRuntime> {
    return await runTimedStep('install', async (): Promise<SelfHostedUserSetupRuntime> => {
      const seed: K3dPlatformSeed = readK3dPlatformSeed();
      const credentials: K3dSuiteOrganizationCredentials = createSuiteCredentials();
      await provisionK3dSuiteOrganization(seed, credentials, async (): Promise<SelfHostedUserSetupCli> => {
        return await this.createFreshCli();
      });
      return {
        adminEmail: credentials.principalEmail,
        adminPassword: credentials.password,
        apiUrl: seed.apiUrl,
        compartmentUrl: seed.compartmentUrl,
        organizationName: credentials.organizationName,
        organizationSlug: credentials.organizationSlug,
      };
    });
  }

  async createFreshCli(): Promise<SelfHostedUserSetupCli> {
    const homeDirectory: string = await mkdtemp(join(tempRootDirectory, 'client-home-'));
    this.#clientHomeDirectories.push(homeDirectory);
    return new SelfHostedUserSetupCli(buildSelfHostedUserSetupClientEnv(homeDirectory), clientCommandTimeoutMs);
  }

  async createAppFixture(options: SelfHostedUserSetupAppFixtureOptions = {}): Promise<SelfHostedUserSetupAppFixture> {
    const fixture: SelfHostedUserSetupAppFixture = await createSelfHostedUserSetupAppFixture(
      tempRootDirectory,
      options,
    );
    this.#appFixtureDirectories.push(fixture.directory);
    return fixture;
  }
}

function createSuiteCredentials(): K3dSuiteOrganizationCredentials {
  const suffix: string = randomUUID().replaceAll('-', '').slice(0, 12);
  return {
    organizationName: `Platform E2E ${suffix}`,
    organizationSlug: `platform-e2e-${suffix}`,
    password: `PlatformE2e-${suffix}-${randomUUID().replaceAll('-', '')}!`,
    principalEmail: `admin-${suffix}@compartment.test`,
  };
}
