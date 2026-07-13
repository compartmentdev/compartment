import { setTimeout as delay } from 'node:timers/promises';
import {
  activateResponseSchema,
  createOrganizationResponseSchema,
  inviteUserResponseSchema,
  removeUserResponseSchema,
  type InviteUserResponse,
} from '@compartment/contracts';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { requireActivationToken } from './self-hosted-user-setup-cli-response.harness';
import {
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

// In k3d mode the platform is provisioned externally (helm via
// scripts/deploy/platform-k3d-e2e.mjs) and seeded once with `install --dev`;
// suites receive that seed through env and provision isolated per-suite
// organizations instead of installing the runtime themselves.
export interface K3dPlatformSeed {
  readonly apiUrl: string;
  readonly compartmentUrl: string;
  readonly kubeContext: string;
  readonly platformNamespace: string;
  readonly seedAdminEmail: string;
  readonly seedAdminPassword: string;
}

export interface K3dSuiteOrganizationCredentials {
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly password: string;
  readonly principalEmail: string;
}

const e2ePlatformModeEnvName: string = 'COMPARTMENT_E2E_PLATFORM_MODE';
const k3dCompartmentUrlEnvName: string = 'COMPARTMENT_E2E_COMPARTMENT_URL';
const k3dApiUrlEnvName: string = 'COMPARTMENT_E2E_API_URL';
const k3dSeedAdminEmailEnvName: string = 'COMPARTMENT_E2E_SEED_ADMIN_EMAIL';
const k3dKubeContextEnvName: string = 'COMPARTMENT_E2E_KUBE_CONTEXT';
const k3dPlatformNamespaceEnvName: string = 'COMPARTMENT_E2E_PLATFORM_NAMESPACE';
const k3dDefaultKubeContext: string = 'k3d-compartment-e2e';
const k3dDefaultPlatformNamespace: string = 'compartment';
const k3dPlatformResourceName: string = 'compartment-compartment';
const k3dKubectlCommandTimeoutMs: number = 8 * 60_000;

export function isK3dPlatformMode(): boolean {
  return process.env[e2ePlatformModeEnvName] === 'k3d';
}

export function readK3dPlatformSeed(): K3dPlatformSeed {
  return {
    apiUrl: readRequiredK3dEnv(k3dApiUrlEnvName),
    compartmentUrl: readRequiredK3dEnv(k3dCompartmentUrlEnvName),
    kubeContext: process.env[k3dKubeContextEnvName] ?? k3dDefaultKubeContext,
    platformNamespace: process.env[k3dPlatformNamespaceEnvName] ?? k3dDefaultPlatformNamespace,
    seedAdminEmail: readRequiredK3dEnv(k3dSeedAdminEmailEnvName),
    seedAdminPassword: readRequiredK3dEnv('COMPARTMENT_E2E_SEED_ADMIN_PASSWORD'),
  };
}

function readRequiredK3dEnv(envName: string): string {
  const value: string | undefined = process.env[envName];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${envName} is required when ${e2ePlatformModeEnvName}=k3d.`);
  }

  return value;
}

export async function provisionK3dSuiteOrganization(
  seed: K3dPlatformSeed,
  credentials: K3dSuiteOrganizationCredentials,
  createFreshCli: () => Promise<SelfHostedUserSetupCli>,
): Promise<void> {
  const seedCli: SelfHostedUserSetupCli = await createFreshCli();
  await seedCli.runBrowserLogin(
    `login --api-url ${seed.apiUrl} --email ${seed.seedAdminEmail} --output json`,
    {
      email: seed.seedAdminEmail,
      password: seed.seedAdminPassword,
    },
    { requestOrigin: seed.apiUrl },
  );

  const invitePayload: InviteUserResponse = await seedCli.runJson(
    `user invite ${credentials.principalEmail}`,
    inviteUserResponseSchema,
  );
  const activationToken: string = requireActivationToken(invitePayload);

  const suiteCli: SelfHostedUserSetupCli = await createFreshCli();
  await suiteCli.runJson(
    `activate --api-url ${seed.apiUrl} --email ${credentials.principalEmail} --token ${activationToken}`,
    activateResponseSchema,
    {
      input: `${credentials.password}\n${credentials.password}\n`,
    },
  );
  await suiteCli.runBrowserLogin(
    `login --api-url ${seed.apiUrl} --email ${credentials.principalEmail} --output json`,
    {
      email: credentials.principalEmail,
      password: credentials.password,
    },
    { requestOrigin: seed.apiUrl },
  );
  await suiteCli.runJson(
    `org create --name "${credentials.organizationName}" --slug ${credentials.organizationSlug}`,
    createOrganizationResponseSchema,
  );
  await seedCli.runJson(`user remove ${credentials.principalEmail} --yes`, removeUserResponseSchema);
}

export async function configureK3dTrustedOutboundHosts(trustedHostList: string): Promise<void> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const kubectlBaseArgv: readonly string[] = [
    'kubectl',
    '--context',
    seed.kubeContext,
    '--namespace',
    seed.platformNamespace,
  ];
  const patchPayload: string = JSON.stringify({
    data: { COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: trustedHostList },
  });

  const commands: readonly (readonly string[])[] = [
    [...kubectlBaseArgv, 'patch', 'configmap', k3dPlatformResourceName, '--type', 'merge', '--patch', patchPayload],
    [
      ...kubectlBaseArgv,
      'rollout',
      'restart',
      `deployment/${k3dPlatformResourceName}-api`,
      `deployment/${k3dPlatformResourceName}-worker`,
    ],
    [...kubectlBaseArgv, 'rollout', 'status', `deployment/${k3dPlatformResourceName}-api`, '--timeout=2m'],
    [...kubectlBaseArgv, 'rollout', 'status', `deployment/${k3dPlatformResourceName}-worker`, '--timeout=2m'],
  ];
  for (const argv of commands) {
    const result: SelfHostedUserSetupCommandResult = await runCommand({
      argv,
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
    expectSuccessfulCommand(result, `configure trusted outbound hosts: ${argv.slice(5).join(' ')}`, '');
  }

  await waitForK3dApiReadiness(seed.apiUrl);
}

async function waitForK3dApiReadiness(apiUrl: string): Promise<void> {
  for (let waitedSeconds: number = 0; waitedSeconds < 60; waitedSeconds += 2) {
    try {
      const response: Response = await fetch(`${apiUrl}/readyz`);
      if (response.ok) {
        return;
      }
    } catch {
      // The API is expected to refuse connections while the rollout converges.
    }
    await delay(2_000);
  }

  throw new Error(`Timed out waiting for API readiness at ${apiUrl}/readyz after the trusted host update.`);
}
