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
const k3dBuildkitNamespace: string = 'compartment-build';
const k3dBuildkitAddress: string = 'tcp://127.0.0.1:1234';
const k3dKubectlCommandTimeoutMs: number = 8 * 60_000;
const k3dApiServiceProbeAttempts: number = 30;
const k3dApiServiceProbeIntervalMs: number = 1_000;
const k3dApiServiceProbeTimeoutMs: number = 10_000;
const k3dApiBoundaryProbeScript: string = `
const [apiUrl, email] = process.argv.slice(1);
const response = await fetch(new URL('/v1/auth/login-discovery', apiUrl), {
  body: JSON.stringify({ autoRedirect: false, email }),
  headers: { 'content-type': 'application/json' },
  method: 'POST',
});
if (!response.ok) {
  throw new Error(\`API boundary returned status \${String(response.status)}.\`);
}
`;
const k3dAuditFileSinkPath: string = '/var/lib/compartment/audit-logs/audit.ndjson';

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
  await expectK3dProjectProvisionerIsolation(seed);
  await expectK3dProjectProvisionerAdmissionBoundary(seed);
  await expectK3dBootstrapAdmissionBoundary(seed);
}

async function expectK3dProjectProvisionerIsolation(seed: K3dPlatformSeed): Promise<void> {
  const identity: string = `system:serviceaccount:${seed.platformNamespace}:${k3dPlatformResourceName}-project-provisioner`;
  const assertions: readonly (readonly string[])[] = [
    ['get', `secret/${k3dPlatformResourceName}`, '--namespace', seed.platformNamespace],
    ['create', 'jobs', '--namespace', seed.platformNamespace],
    ['delete', 'clusterrolebinding/cluster-admin'],
  ];
  for (const assertion of assertions) {
    const result: SelfHostedUserSetupCommandResult = await runCommand({
      argv: ['kubectl', '--context', seed.kubeContext, 'auth', 'can-i', ...assertion, `--as=${identity}`],
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
    expectFailedCommand(result, `verify project provisioner RBAC denial: ${assertion.join(' ')}`);
    expect(result.stdout.trim()).toBe('no');
  }
}

async function expectK3dProjectProvisionerAdmissionBoundary(seed: K3dPlatformSeed): Promise<void> {
  const identity: string = `system:serviceaccount:${seed.platformNamespace}:${k3dPlatformResourceName}-project-provisioner`;
  await expectK3dProjectProvisionerClusterRoleBindingDenied(
    seed,
    identity,
    'compartment-project-bootstrap',
    'kube-system',
    'default',
    'deny permanent provisioner bootstrap authority in kube-system',
  );
  await expectK3dProjectProvisionerClusterRoleBindingDenied(
    seed,
    identity,
    `cpt-rbac-provisioner-${process.pid.toString()}`,
    `${k3dPlatformResourceName}-project-provisioning`,
    `cpt-rbac-subject-${process.pid.toString()}`,
    'deny permanent provisioner noncanonical bootstrap binding',
  );
}

async function expectK3dProjectProvisionerClusterRoleBindingDenied(
  seed: K3dPlatformSeed,
  identity: string,
  bindingName: string,
  subjectNamespace: string,
  subjectName: string,
  assertion: string,
): Promise<void> {
  const denied: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      seed.kubeContext,
      'create',
      'clusterrolebinding',
      bindingName,
      '--clusterrole=compartment-project-bootstrap',
      `--serviceaccount=${subjectNamespace}:${subjectName}`,
      '--dry-run=server',
      `--as=${identity}`,
    ],
    timeoutMs: k3dKubectlCommandTimeoutMs,
  });
  expectFailedCommand(denied, assertion);
  expect(denied.stderr).toContain(
    'Project provisioner may manage only the canonical short-lived bootstrap ClusterRoleBinding.',
  );
}

async function expectK3dBootstrapAdmissionBoundary(seed: K3dPlatformSeed): Promise<void> {
  const targetNamespace: string = `cpt-rbac-${process.pid.toString()}`;
  const provisioningNamespace: string = `${k3dPlatformResourceName}-project-provisioning`;
  const identity: string = `system:serviceaccount:${provisioningNamespace}:${targetNamespace}`;
  const existingBinding: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      seed.kubeContext,
      'get',
      'clusterrolebinding',
      'compartment-project-bootstrap',
      '--ignore-not-found',
      '--output=name',
    ],
    timeoutMs: k3dKubectlCommandTimeoutMs,
  });
  expectSuccessfulCommand(existingBinding, 'verify the bootstrap authority is not already active', '');
  expect(existingBinding.stdout.trim()).toBe('');
  const setupCommands: readonly (readonly string[])[] = [
    ['kubectl', '--context', seed.kubeContext, 'create', 'namespace', targetNamespace],
    [
      'kubectl',
      '--context',
      seed.kubeContext,
      '--namespace',
      provisioningNamespace,
      'create',
      'serviceaccount',
      targetNamespace,
    ],
    [
      'kubectl',
      '--context',
      seed.kubeContext,
      'create',
      'clusterrolebinding',
      'compartment-project-bootstrap',
      '--clusterrole=compartment-project-bootstrap',
      `--serviceaccount=${provisioningNamespace}:${targetNamespace}`,
    ],
  ];
  try {
    await runK3dKubectlCommands(setupCommands);
    const namespaceDenied: SelfHostedUserSetupCommandResult = await runCommand({
      argv: [
        'kubectl',
        '--context',
        seed.kubeContext,
        'create',
        'namespace',
        `${targetNamespace}-bypass`,
        `--as=${identity}`,
      ],
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
    expectFailedCommand(namespaceDenied, 'deny bootstrap namespace creation outside its encoded namespace');
    expect(namespaceDenied.stderr).toContain(
      'Project bootstrap authority is restricted to its encoded target namespace.',
    );

    const subjectDenied: SelfHostedUserSetupCommandResult = await runCommand({
      argv: [
        'kubectl',
        '--context',
        seed.kubeContext,
        '--namespace',
        targetNamespace,
        'create',
        'rolebinding',
        'compartment-project-bootstrap',
        '--clusterrole=compartment-controller',
        `--serviceaccount=${provisioningNamespace}:${targetNamespace}`,
        '--serviceaccount=kube-system:namespace-controller',
        `--as=${identity}`,
      ],
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
    expectFailedCommand(subjectDenied, 'deny bootstrap RoleBinding subject injection');
    expect(subjectDenied.stderr).toContain(
      'Project bootstrap authority may manage only canonical controller RoleBindings.',
    );

    await runK3dKubectlCommands([
      [
        'kubectl',
        '--context',
        seed.kubeContext,
        '--namespace',
        targetNamespace,
        'create',
        'rolebinding',
        'compartment-project-bootstrap',
        '--clusterrole=compartment-controller',
        `--serviceaccount=${provisioningNamespace}:${targetNamespace}`,
        `--serviceaccount=${seed.platformNamespace}:${k3dPlatformResourceName}-worker`,
        `--as=${identity}`,
      ],
    ]);
  } finally {
    await runK3dKubectlCommands([
      [
        'kubectl',
        '--context',
        seed.kubeContext,
        '--namespace',
        targetNamespace,
        'delete',
        'rolebinding',
        'compartment-project-bootstrap',
        '--ignore-not-found',
      ],
      [
        'kubectl',
        '--context',
        seed.kubeContext,
        'delete',
        'clusterrolebinding',
        'compartment-project-bootstrap',
        '--ignore-not-found',
      ],
      [
        'kubectl',
        '--context',
        seed.kubeContext,
        'delete',
        'namespace',
        targetNamespace,
        `${targetNamespace}-bypass`,
        '--ignore-not-found',
        '--wait=false',
      ],
    ]);
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

export async function reclaimK3dBuildStorage(): Promise<void> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const nodeResult: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['kubectl', '--context', seed.kubeContext, 'get', 'nodes', '--output=jsonpath={.items[0].metadata.name}'],
    timeoutMs: k3dKubectlCommandTimeoutMs,
  });
  expectSuccessfulCommand(nodeResult, 'read the k3d server node name', '');
  const nodeName: string = nodeResult.stdout.trim();
  if (nodeName === '') {
    throw new Error('Expected the k3d cluster to contain a server node.');
  }

  const commands: readonly (readonly string[])[] = [
    [
      'kubectl',
      '--context',
      seed.kubeContext,
      '--namespace',
      k3dBuildkitNamespace,
      'exec',
      `deployment/${k3dPlatformResourceName}-buildkit`,
      '--',
      'buildctl',
      '--addr',
      k3dBuildkitAddress,
      'prune',
      '--all',
    ],
    ['docker', 'exec', nodeName, 'crictl', 'rmi', '--prune'],
    [
      'kubectl',
      '--context',
      seed.kubeContext,
      'wait',
      `node/${nodeName}`,
      '--for=condition=DiskPressure=false',
      '--timeout=2m',
    ],
  ];
  await runK3dKubectlCommands(commands);
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

export async function enableK3dAuditFileSink(): Promise<string> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const kubectlBaseArgv: readonly string[] = buildK3dKubectlBaseArgv(seed);
  const patchPayload: string = JSON.stringify({ data: { COMPARTMENT_AUDIT_FILE_SINK_ENABLED: 'true' } });
  await runK3dKubectlCommands([
    [
      ...kubectlBaseArgv,
      'exec',
      `deployment/${k3dPlatformResourceName}-api`,
      '--',
      'sh',
      '-c',
      `rm -f ${k3dAuditFileSinkPath}`,
    ],
    [...kubectlBaseArgv, 'patch', 'configmap', k3dPlatformResourceName, '--type', 'merge', '--patch', patchPayload],
    [...kubectlBaseArgv, 'rollout', 'restart', `deployment/${k3dPlatformResourceName}-api`],
    [...kubectlBaseArgv, 'rollout', 'status', `deployment/${k3dPlatformResourceName}-api`, '--timeout=2m'],
  ]);
  await waitForK3dApiService(seed);
  return k3dAuditFileSinkPath;
}

export async function readK3dAuditFileSink(): Promise<string> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      ...buildK3dKubectlBaseArgv(seed),
      'exec',
      `deployment/${k3dPlatformResourceName}-api`,
      '--',
      'sh',
      '-c',
      `cat ${k3dAuditFileSinkPath} 2>/dev/null || true`,
    ],
    timeoutMs: k3dKubectlCommandTimeoutMs,
  });
  expectSuccessfulCommand(result, 'read the k3d API audit file sink', '');
  return result.stdout;
}

function buildK3dKubectlBaseArgv(seed: K3dPlatformSeed): readonly string[] {
  return ['kubectl', '--context', seed.kubeContext, '--namespace', seed.platformNamespace];
}

async function runK3dKubectlCommands(commands: readonly (readonly string[])[]): Promise<void> {
  for (const argv of commands) {
    const result: SelfHostedUserSetupCommandResult = await runCommand({
      argv,
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
    expectSuccessfulCommand(result, `run k3d platform command: ${argv.slice(5).join(' ')}`, '');
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

  result = await probeK3dApiBoundary(seed);
  for (let attempt: number = 1; result.exitCode !== 0 && attempt < k3dApiServiceProbeAttempts; attempt += 1) {
    await sleep(k3dApiServiceProbeIntervalMs);
    result = await probeK3dApiBoundary(seed);
  }
  expectSuccessfulCommand(result, 'wait for the API public boundary to converge', '');
}

async function probeK3dApiService(seed: K3dPlatformSeed, proxyPath: string): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: ['kubectl', '--context', seed.kubeContext, 'get', '--raw', proxyPath],
    timeoutMs: k3dApiServiceProbeTimeoutMs,
  });
}

async function probeK3dApiBoundary(seed: K3dPlatformSeed): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: [
      process.execPath,
      '--input-type=module',
      '--eval',
      k3dApiBoundaryProbeScript,
      seed.apiUrl,
      seed.seedAdminEmail,
    ],
    timeoutMs: k3dApiServiceProbeTimeoutMs,
  });
}
