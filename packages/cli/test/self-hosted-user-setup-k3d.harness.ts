import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  accessAssignmentListResponseSchema,
  accessAssignmentResponseSchema,
  accessRoleListResponseSchema,
  activateResponseSchema,
  createOrganizationResponseSchema,
  inviteUserResponseSchema,
  removeUserResponseSchema,
  resourceBackupCreateResponseSchema,
  resourceBackupListResponseSchema,
  userListResponseSchema,
  type AccessAssignmentListResponse,
  type AccessAssignmentResponse,
  type AccessAssignmentSummary,
  type AccessRoleListResponse,
  type AccessRoleListRow,
  type InviteUserResponse,
  type OrganizationUserListRow,
  type ResourceBackupCreateResponse,
  type ResourceBackupListResponse,
  type ResourceBackupSummary,
  type UserListResponse,
} from '@compartment/contracts';
import { expect } from 'vitest';
import { immutableKubeName } from '@compartment/utils';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { requireActivationToken } from './self-hosted-user-setup-cli-response.harness';
import {
  expectFailedCommand,
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

// The first k3d suite installs the platform through the production Helm-backed
// CLI command and publishes its owner through env. Later suites provision
// isolated organizations through that owner instead of reinstalling the platform.
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

interface K3dBackupRetentionAssertionInput {
  readonly expiredBackupId: string;
  readonly projectId: string;
  readonly resourceId: string;
  readonly retainedBackupId: string;
}

const e2ePlatformModeEnvName: string = 'COMPARTMENT_E2E_PLATFORM_MODE';
const k3dCompartmentUrlEnvName: string = 'COMPARTMENT_E2E_COMPARTMENT_URL';
const k3dApiUrlEnvName: string = 'COMPARTMENT_E2E_API_URL';
const k3dSeedAdminEmailEnvName: string = 'COMPARTMENT_E2E_SEED_ADMIN_EMAIL';
const k3dKubeContextEnvName: string = 'COMPARTMENT_E2E_KUBE_CONTEXT';
const k3dPlatformNamespaceEnvName: string = 'COMPARTMENT_E2E_PLATFORM_NAMESPACE';
const k3dDefaultKubeContext: string = 'k3d-compartment-e2e';
const k3dDefaultPlatformNamespace: string = 'compartment';
const k3dPlatformResourceName: string = 'compartment';
const k3dKubectlCommandTimeoutMs: number = 8 * 60_000;
const k3dRolloutTimeout: string = '4m';
const k3dApiServiceProbeAttempts: number = 30;
const k3dApiServiceProbeIntervalMs: number = 1_000;
const k3dApiServiceProbeTimeoutMs: number = 10_000;
const k3dBackupRetentionPollAttempts: number = 90;
const k3dBackupRetentionPollDelayMs: number = 2_000;
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

export async function seedK3dProjectTeardownFixture(projectId: string): Promise<void> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const namespace: string = immutableKubeName('cpt', projectId);
  const workerImage: string = await readK3dWorkerImage(seed);
  await runK3dKubectlCommands([
    [
      'kubectl',
      '--context',
      seed.kubeContext,
      '--namespace',
      namespace,
      'create',
      'secret',
      'generic',
      'gc-regression-secret',
      '--from-literal=value=present',
    ],
  ]);
  const jobManifest: string = JSON.stringify({
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: 'gc-regression-job', namespace },
    spec: {
      template: {
        metadata: { labels: { 'compartment.dev/test': 'gc-regression' } },
        spec: {
          automountServiceAccountToken: false,
          containers: [
            {
              command: ['node', '-e', 'process.exit(0)'],
              image: workerImage,
              name: 'job',
              securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
            },
          ],
          restartPolicy: 'Never',
          securityContext: {
            runAsGroup: 10_001,
            runAsNonRoot: true,
            runAsUser: 10_001,
            seccompProfile: { type: 'RuntimeDefault' },
          },
        },
      },
    },
  });
  const applied: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['kubectl', '--context', seed.kubeContext, 'apply', '--filename=-'],
    input: jobManifest,
    timeoutMs: k3dKubectlCommandTimeoutMs,
  });
  expectSuccessfulCommand(applied, `seed teardown Job in ${namespace}`, '');
  await runK3dKubectlCommands([
    [
      'kubectl',
      '--context',
      seed.kubeContext,
      '--namespace',
      namespace,
      'wait',
      'job/gc-regression-job',
      '--for=condition=complete',
      '--timeout=2m',
    ],
  ]);
}

export async function expectK3dProjectNamespaceDeleted(projectId: string): Promise<void> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const namespace: string = immutableKubeName('cpt', projectId);
  let result: SelfHostedUserSetupCommandResult = await readK3dNamespaceIfPresent(seed, namespace);
  for (let attempt: number = 0; result.stdout.trim() !== '' && attempt < 60; attempt += 1) {
    await sleep(1_000);
    result = await readK3dNamespaceIfPresent(seed, namespace);
  }
  expectSuccessfulCommand(result, `wait for deleted project namespace ${namespace}`, '');
  expect(result.stdout.trim()).toBe('');
  for (const [resource, selector] of [
    ['jobs', 'metadata.name=gc-regression-job'],
    ['pods', 'compartment.dev/test=gc-regression'],
    ['secrets', 'metadata.name=gc-regression-secret'],
  ] as const) {
    const childResult: SelfHostedUserSetupCommandResult = await runCommand({
      argv: [
        'kubectl',
        '--context',
        seed.kubeContext,
        'get',
        resource,
        '--all-namespaces',
        resource === 'pods' ? '--selector' : '--field-selector',
        selector,
        '--output=name',
      ],
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
    expectSuccessfulCommand(childResult, `verify deleted project ${resource} are absent`, '');
    expect(childResult.stdout.trim()).toBe('');
  }
}

export async function expectK3dProjectNamespaceActive(projectId: string): Promise<void> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  expectSuccessfulCommand(
    await readK3dNamespace(seed, immutableKubeName('cpt', projectId)),
    `verify active project namespace ${projectId}`,
    '',
  );
}

export async function expectK3dBackupRetentionFlow(
  cli: SelfHostedUserSetupCli,
  fixtureDirectory: string,
  projectName: string,
  resourceName: string,
): Promise<string> {
  const expired: ResourceBackupCreateResponse = await cli.runJson(
    `resource backup create --project ${projectName} --resource ${resourceName}`,
    resourceBackupCreateResponseSchema,
  );
  const retained: ResourceBackupCreateResponse = await cli.runJson(
    `resource backup create --project ${projectName} --resource ${resourceName}`,
    resourceBackupCreateResponseSchema,
  );
  expect(expired.backup.status).toBe('succeeded');
  expect(retained.backup.status).toBe('succeeded');
  const retention: ResourceBackupListResponse = await waitForK3dBackupRetentionCleanup(
    cli,
    projectName,
    resourceName,
    expired.backup.id,
  );
  expect(retention.scheduledOperation?.cleanedCount).toBeGreaterThan(0);
  await expectK3dBackupRetentionCleanup({
    expiredBackupId: expired.backup.id,
    projectId: expired.project.id,
    resourceId: expired.backup.resource.id,
    retainedBackupId: retained.backup.id,
  });
  await disableK3dBackupRetentionSchedule(cli, fixtureDirectory, projectName);
  const restoreBackup: ResourceBackupCreateResponse = await cli.runJson(
    `resource backup create --project ${projectName} --resource ${resourceName}`,
    resourceBackupCreateResponseSchema,
  );
  expect(restoreBackup.backup.status).toBe('succeeded');
  return restoreBackup.backup.id;
}

async function disableK3dBackupRetentionSchedule(
  cli: SelfHostedUserSetupCli,
  fixtureDirectory: string,
  projectName: string,
): Promise<void> {
  const descriptorPath: string = join(fixtureDirectory, 'compartment.yml');
  const descriptor: string = await readFile(descriptorPath, 'utf8');
  const schedule: string = `        schedule:
          cron: '* * * * *'
          retention:
            includeManual: true
            keepLast: 2
`;
  if (!descriptor.includes(schedule)) {
    throw new Error('Expected the k3d app fixture to contain the backup retention schedule.');
  }
  await writeFile(descriptorPath, descriptor.replace(schedule, ''), 'utf8');
  await cli.run(`deploy --project ${projectName}`, { cwd: fixtureDirectory });
}

async function waitForK3dBackupRetentionCleanup(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  resourceName: string,
  expiredBackupId: string,
): Promise<ResourceBackupListResponse> {
  let payload: ResourceBackupListResponse | undefined;
  for (let attempt: number = 0; attempt < k3dBackupRetentionPollAttempts; attempt += 1) {
    payload = await cli.runJson(
      `resource backup list --project ${projectName} --resource ${resourceName}`,
      resourceBackupListResponseSchema,
    );
    const expired: ResourceBackupSummary | undefined = payload.backups.find(
      (backup: ResourceBackupSummary): boolean => backup.id === expiredBackupId,
    );
    if (expired?.status === 'deleted' && expired.retentionDeletedAt !== null) {
      return payload;
    }
    await sleep(k3dBackupRetentionPollDelayMs);
  }
  throw new Error(`Timed out waiting for retention to clean backup ${expiredBackupId}: ${JSON.stringify(payload)}`);
}

async function expectK3dBackupRetentionCleanup(input: K3dBackupRetentionAssertionInput): Promise<void> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const workerImage: string = await readK3dWorkerImage(seed);
  const namespace: string = immutableKubeName('cpt', input.projectId);
  const claimName: string = immutableKubeName('volume', `${input.resourceId}:backup-artifacts`);
  const verifierName: string = immutableKubeName('retention-check', input.expiredBackupId);
  const overrides: string = JSON.stringify({
    spec: {
      automountServiceAccountToken: false,
      containers: [
        {
          args: [
            `const fs=require('node:fs');const retained='/backups/${input.retainedBackupId}/dump.sql';if(fs.existsSync('/backups/${input.expiredBackupId}')||!fs.existsSync(retained)||fs.statSync(retained).size===0)process.exit(1)`,
          ],
          command: ['node', '-e'],
          image: workerImage,
          name: verifierName,
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
          volumeMounts: [{ mountPath: '/backups', name: 'backups' }],
        },
      ],
      restartPolicy: 'Never',
      securityContext: {
        fsGroup: 10_001,
        runAsGroup: 10_001,
        runAsNonRoot: true,
        runAsUser: 10_001,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      volumes: [{ name: 'backups', persistentVolumeClaim: { claimName } }],
    },
  });
  try {
    await runK3dKubectlCommands([
      [
        'kubectl',
        '--context',
        seed.kubeContext,
        '--namespace',
        namespace,
        'run',
        verifierName,
        `--image=${workerImage}`,
        `--overrides=${overrides}`,
        '--restart=Never',
      ],
      [
        'kubectl',
        '--context',
        seed.kubeContext,
        '--namespace',
        namespace,
        'wait',
        `pod/${verifierName}`,
        '--for=jsonpath={.status.phase}=Succeeded',
        '--timeout=2m',
      ],
    ]);
  } finally {
    await runCommand({
      argv: [
        'kubectl',
        '--context',
        seed.kubeContext,
        '--namespace',
        namespace,
        'delete',
        'pod',
        verifierName,
        '--ignore-not-found',
      ],
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
  }
}

async function readK3dNamespace(seed: K3dPlatformSeed, namespace: string): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: ['kubectl', '--context', seed.kubeContext, 'get', 'namespace', namespace],
    timeoutMs: k3dKubectlCommandTimeoutMs,
  });
}

async function readK3dWorkerImage(seed: K3dPlatformSeed): Promise<string> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      seed.kubeContext,
      '--namespace',
      seed.platformNamespace,
      'get',
      'deployment',
      `${k3dPlatformResourceName}-worker`,
      '--output=jsonpath={.spec.template.spec.containers[0].image}',
    ],
    timeoutMs: k3dKubectlCommandTimeoutMs,
  });
  expectSuccessfulCommand(result, 'read the installed worker image', '');
  const image: string = result.stdout.trim();
  if (image === '') {
    throw new Error('Expected the installed worker Deployment to use an image.');
  }
  return image;
}

async function readK3dNamespaceIfPresent(
  seed: K3dPlatformSeed,
  namespace: string,
): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: [
      'kubectl',
      '--context',
      seed.kubeContext,
      'get',
      'namespace',
      namespace,
      '--ignore-not-found',
      '--output=name',
    ],
    timeoutMs: k3dKubectlCommandTimeoutMs,
  });
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
  const namespaceDelete: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['kubectl', '--context', seed.kubeContext, 'auth', 'can-i', 'delete', 'namespaces', `--as=${identity}`],
    timeoutMs: k3dKubectlCommandTimeoutMs,
  });
  expectSuccessfulCommand(namespaceDelete, 'verify project provisioner namespace teardown authority', '');
  expect(namespaceDelete.stdout.trim()).toBe('yes');
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
  await expectK3dProjectProvisionerNamespaceDeleteDenied(seed, identity);
}

async function expectK3dProjectProvisionerNamespaceDeleteDenied(
  seed: K3dPlatformSeed,
  identity: string,
): Promise<void> {
  const namespace: string = `gc-boundary-${process.pid.toString()}`;
  await runK3dKubectlCommands([['kubectl', '--context', seed.kubeContext, 'create', 'namespace', namespace]]);
  try {
    const denied: SelfHostedUserSetupCommandResult = await runCommand({
      argv: [
        'kubectl',
        '--context',
        seed.kubeContext,
        'delete',
        'namespace',
        namespace,
        '--dry-run=server',
        `--as=${identity}`,
      ],
      timeoutMs: k3dKubectlCommandTimeoutMs,
    });
    expectFailedCommand(denied, 'deny project provisioner teardown outside managed project namespaces');
    expect(denied.stderr).toContain('Project bootstrap authority is restricted to its encoded target namespace.');
  } finally {
    await runK3dKubectlCommands([
      ['kubectl', '--context', seed.kubeContext, 'delete', 'namespace', namespace, '--wait=false'],
    ]);
  }
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
      interactive: true,
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
    [
      ...kubectlBaseArgv,
      'rollout',
      'status',
      `deployment/${k3dPlatformResourceName}-api`,
      `--timeout=${k3dRolloutTimeout}`,
    ],
  ];
  await runK3dKubectlCommands(apiCommands);
  await waitForK3dApiService(seed);
  await runK3dKubectlCommands([
    [...kubectlBaseArgv, 'rollout', 'restart', `deployment/${k3dPlatformResourceName}-worker`],
    [
      ...kubectlBaseArgv,
      'rollout',
      'status',
      `deployment/${k3dPlatformResourceName}-worker`,
      `--timeout=${k3dRolloutTimeout}`,
    ],
  ]);
}

export async function enableK3dAuditFileSink(): Promise<string> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const kubectlBaseArgv: readonly string[] = buildK3dKubectlBaseArgv(seed);
  const patchPayload: string = JSON.stringify({ data: { COMPARTMENT_AUDIT_FILE_SINK_ENABLED: 'true' } });
  await runK3dKubectlCommands([
    [...kubectlBaseArgv, 'scale', `deployment/${k3dPlatformResourceName}-api`, '--replicas=1'],
    [
      ...kubectlBaseArgv,
      'rollout',
      'status',
      `deployment/${k3dPlatformResourceName}-api`,
      `--timeout=${k3dRolloutTimeout}`,
    ],
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
    [
      ...kubectlBaseArgv,
      'rollout',
      'status',
      `deployment/${k3dPlatformResourceName}-api`,
      `--timeout=${k3dRolloutTimeout}`,
    ],
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
