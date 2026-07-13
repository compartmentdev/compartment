import { setTimeout as sleep } from 'node:timers/promises';
import {
  accessAssignmentListResponseSchema,
  accessAssignmentResponseSchema,
  accessRoleListResponseSchema,
  activateResponseSchema,
  createOrganizationResponseSchema,
  inviteUserResponseSchema,
  removeUserResponseSchema,
  userListResponseSchema,
  type AccessAssignmentListResponse,
  type AccessAssignmentResponse,
  type AccessAssignmentSummary,
  type AccessRoleListResponse,
  type AccessRoleListRow,
  type InviteUserResponse,
  type OrganizationUserListRow,
  type UserListResponse,
} from '@compartment/contracts';
import { expect } from 'vitest';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { requireActivationToken } from './self-hosted-user-setup-cli-response.harness';
import {
  expectFailedCommand,
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
const k3dApiServiceProbeAttempts: number = 30;
const k3dApiServiceProbeIntervalMs: number = 1_000;
const k3dApiServiceProbeTimeoutMs: number = 10_000;

export function isK3dPlatformMode(): boolean {
  return process.env[e2ePlatformModeEnvName] === 'k3d';
}

export async function expectK3dWorkerNamespaceIsolation(): Promise<void> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const workerIdentity: string = `system:serviceaccount:${seed.platformNamespace}:${k3dPlatformResourceName}-worker`;
  const assertions: readonly (readonly string[])[] = [
    ['patch', 'secrets', '--namespace', 'default'],
    ['create', 'namespaces'],
  ];
  for (const assertion of assertions) {
    const result: SelfHostedUserSetupCommandResult = await runCommand({
      argv: ['kubectl', '--context', seed.kubeContext, 'auth', 'can-i', ...assertion, `--as=${workerIdentity}`],
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
    expectFailedCommand(result, `verify worker RBAC denial: ${assertion.join(' ')}`);
    expect(result.stdout.trim()).toBe('no');
  }
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
  const roleList: AccessRoleListResponse = await seedCli.runJson('role list', accessRoleListResponseSchema);
  const systemAdminRoleId: string = requireSystemAdminRoleId(roleList);
  const temporaryAssignment: AccessAssignmentResponse = await seedCli.runJson(
    `assignment create --role ${systemAdminRoleId} --scope organization --user ${credentials.principalEmail}`,
    accessAssignmentResponseSchema,
  );

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

  const users: UserListResponse = await seedCli.runJson('user list --per-page 100', userListResponseSchema);
  expect(users.pagination.totalItems).toBeLessThanOrEqual(users.pagination.perPage);
  expect(users.users.some((user: OrganizationUserListRow): boolean => user.email === credentials.principalEmail)).toBe(
    false,
  );

  const assignments: AccessAssignmentListResponse = await seedCli.runJson(
    'assignment list',
    accessAssignmentListResponseSchema,
  );
  expect(
    assignments.assignments.some(
      (assignment: AccessAssignmentSummary): boolean => assignment.id === temporaryAssignment.assignment.id,
    ),
  ).toBe(false);
  expect(
    assignments.assignments.some(
      (assignment: AccessAssignmentSummary): boolean =>
        assignment.subject.subjectType === 'principal' &&
        assignment.subject.principalEmail === credentials.principalEmail,
    ),
  ).toBe(false);
}

function requireSystemAdminRoleId(roleList: AccessRoleListResponse): string {
  const adminRoles: AccessRoleListRow[] = roleList.roles.filter(
    (role: AccessRoleListRow): boolean => role.kind === 'system' && role.name === 'admin',
  );
  const adminRole: AccessRoleListRow | undefined = adminRoles[0];
  if (adminRole === undefined || adminRoles.length !== 1) {
    throw new Error(`Expected exactly one system admin role, received ${String(adminRoles.length)}.`);
  }

  return adminRole.id;
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

  const apiCommands: readonly (readonly string[])[] = [
    [...kubectlBaseArgv, 'patch', 'configmap', k3dPlatformResourceName, '--type', 'merge', '--patch', patchPayload],
    [...kubectlBaseArgv, 'rollout', 'restart', `deployment/${k3dPlatformResourceName}-api`],
    [...kubectlBaseArgv, 'rollout', 'status', `deployment/${k3dPlatformResourceName}-api`, '--timeout=2m'],
  ];
  await runK3dKubectlCommands(apiCommands);
  await waitForK3dApiService(seed);
  await runK3dKubectlCommands([
    [...kubectlBaseArgv, 'rollout', 'restart', `deployment/${k3dPlatformResourceName}-worker`],
    [...kubectlBaseArgv, 'rollout', 'status', `deployment/${k3dPlatformResourceName}-worker`, '--timeout=2m'],
  ]);
}

async function runK3dKubectlCommands(commands: readonly (readonly string[])[]): Promise<void> {
  for (const argv of commands) {
    const result: SelfHostedUserSetupCommandResult = await runCommand({
      argv,
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
    expectSuccessfulCommand(result, `configure trusted outbound hosts: ${argv.slice(5).join(' ')}`, '');
  }
}

async function waitForK3dApiService(seed: K3dPlatformSeed): Promise<void> {
  const proxyPath: string = `/api/v1/namespaces/${seed.platformNamespace}/services/http:${k3dPlatformResourceName}-api:39444/proxy/readyz`;
  let result: SelfHostedUserSetupCommandResult = await probeK3dApiService(seed, proxyPath);
  for (let attempt: number = 1; result.exitCode !== 0 && attempt < k3dApiServiceProbeAttempts; attempt += 1) {
    await sleep(k3dApiServiceProbeIntervalMs);
    result = await probeK3dApiService(seed, proxyPath);
  }
  expectSuccessfulCommand(result, 'wait for the API service endpoint to answer /readyz', '');
}

async function probeK3dApiService(seed: K3dPlatformSeed, proxyPath: string): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: ['kubectl', '--context', seed.kubeContext, 'get', '--raw', proxyPath],
    timeoutMs: k3dApiServiceProbeTimeoutMs,
  });
}
