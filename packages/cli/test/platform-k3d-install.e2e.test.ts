import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  installResponseSchema,
  issuePasswordResetResponseSchema,
  systemDomainStatusResponseSchema,
  whoamiCommandResponseSchema,
  type InstallResponse,
  type IssuePasswordResetResponse,
  type SystemDomainStatusResponse,
  type WhoAmICommandResponse,
} from '@compartment/contracts';
import { readSocketSafeTempRootDirectory } from '@compartment/test-support';
import type { JsonValue } from '@compartment/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertBuiltCliAvailable,
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';
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
const kubernetesCommandTimeoutMs: number = 6 * 60_000;
const tempRootDirectory: string = readSocketSafeTempRootDirectory('pk3i-', 'system-api.sock');
const createdDirectories: string[] = [];
const startupWorkloads: readonly StartupWorkload[] = [
  { component: 'worker', containerName: 'worker' },
  { component: 'project-provisioner', containerName: 'project-provisioner' },
];

interface StartupWorkload {
  readonly component: string;
  readonly containerName: string;
}

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

      await expectCleanControllerStartup();
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

      const domainStatus: SystemDomainStatusResponse = await installerCli.runJson(
        `system domain status --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name compartment --output json`,
        systemDomainStatusResponseSchema,
      );
      expect(domainStatus.active.baseDomain).toBe(platformBaseDomain);

      const reset: IssuePasswordResetResponse = await installerCli.runJson(
        `system issue-password-reset --email ${ownerEmail} --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name compartment --output json`,
        issuePasswordResetResponseSchema,
      );
      expect(reset.email).toBe(ownerEmail);
      expect(reset.resetToken).not.toBe('');

      await expectRetainedDomainGenerationProtection();
      await expectRetainedOperatorTlsIdentityOnOrdinaryUpgrade();
    },
    installTimeoutMs,
  );
});

async function createFreshCli(): Promise<SelfHostedUserSetupCli> {
  const homeDirectory: string = await mkdtemp(join(tempRootDirectory, 'client-'));
  createdDirectories.push(homeDirectory);
  return new SelfHostedUserSetupCli(buildSelfHostedUserSetupClientEnv(homeDirectory), installTimeoutMs);
}

async function expectCleanControllerStartup(): Promise<void> {
  for (const workload of startupWorkloads) {
    const deploymentName: string = `compartment-compartment-${workload.component}`;
    const rollout: SelfHostedUserSetupCommandResult = await runKubectl([
      'rollout',
      'status',
      `deployment/${deploymentName}`,
      '--timeout=6m',
    ]);
    expectSuccessfulCommand(rollout, `wait for ${deploymentName}`);

    const pods: SelfHostedUserSetupCommandResult = await runKubectl([
      'get',
      'pods',
      '--selector',
      `app.kubernetes.io/instance=compartment,app.kubernetes.io/component=${workload.component}`,
      '--output=name',
    ]);
    expectSuccessfulCommand(pods, `list ${workload.component} pods`);
    const podNames: readonly string[] = pods.stdout
      .split('\n')
      .map((line: string): string => line.trim())
      .filter(Boolean);
    expect(podNames, `Expected at least one current ${workload.component} pod.`).not.toHaveLength(0);

    for (const podName of podNames) {
      await expectCleanPodStartup(podName, workload);
    }
  }
}

async function expectRetainedDomainGenerationProtection(): Promise<void> {
  const generationResult: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    'secret/compartment-install-state',
    '--output=jsonpath={.data.domain-generation}',
  ]);
  const baseDomainResult: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    'secret/compartment-install-state',
    '--output=jsonpath={.data.base-domain}',
  ]);
  expectSuccessfulCommand(generationResult, 'read the retained domain generation');
  expectSuccessfulCommand(baseDomainResult, 'read the retained base domain');
  const generation: number = Number(Buffer.from(generationResult.stdout, 'base64').toString('utf8'));
  const baseDomain: string = Buffer.from(baseDomainResult.stdout, 'base64').toString('utf8');
  const pendingDomain: string = 'pending-restore3.localhost';
  try {
    await expectSuccessfulHelmDomainUpgrade(generation + 1, pendingDomain, false);
    const retainedAfterRuntimeApply: SelfHostedUserSetupCommandResult = await runKubectl([
      'get',
      'secret/compartment-install-state',
      '--output=jsonpath={.data.base-domain}',
    ]);
    expectSuccessfulCommand(retainedAfterRuntimeApply, 'read retained domain after runtime apply');
    expect(Buffer.from(retainedAfterRuntimeApply.stdout, 'base64').toString('utf8')).toBe(baseDomain);

    await expectSuccessfulHelmDomainUpgrade(generation, 'stale-restore3.localhost', true);
    const renderedDomain: SelfHostedUserSetupCommandResult = await runKubectl([
      'get',
      'configmap/compartment-compartment',
      '--output=jsonpath={.data.COMPARTMENT_BASE_DOMAIN}',
    ]);
    expectSuccessfulCommand(renderedDomain, 'read runtime domain after stale apply');
    expect(renderedDomain.stdout).toBe(baseDomain);
  } finally {
    await expectSuccessfulHelmDomainUpgrade(generation, baseDomain, true);
  }
}

async function expectSuccessfulHelmDomainUpgrade(
  generation: number,
  baseDomain: string,
  domainCommit: boolean,
): Promise<void> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'helm',
      'upgrade',
      'compartment',
      'deploy/chart/compartment',
      '--namespace',
      platformNamespace,
      '--kube-context',
      platformKubeContext,
      '--reuse-values',
      '--values',
      platformValuesPath,
      '--set',
      `platform.baseDomain=${baseDomain}`,
      '--set',
      `platform.domainGeneration=${generation.toString()}`,
      '--set',
      `platform.domainCommit=${domainCommit.toString()}`,
      '--wait',
      '--timeout',
      '10m',
    ],
    timeoutMs: installTimeoutMs,
  });
  expectSuccessfulCommand(result, `apply Helm domain generation ${generation.toString()}`);
}

async function expectRetainedOperatorTlsIdentityOnOrdinaryUpgrade(): Promise<void> {
  const secretName: string = 'restore3-retained-tls';
  const createSecret: SelfHostedUserSetupCommandResult = await runKubectl([
    'create',
    'secret',
    'generic',
    secretName,
    '--from-literal=tls.crt=test-certificate',
    '--from-literal=tls.key=test-private-key',
  ]);
  expectSuccessfulCommand(createSecret, 'create retained operator TLS fixture');
  const labelSecret: SelfHostedUserSetupCommandResult = await runKubectl([
    'label',
    'secret',
    secretName,
    'app.kubernetes.io/managed-by=Helm',
  ]);
  expectSuccessfulCommand(labelSecret, 'label retained operator TLS fixture');
  const annotateSecret: SelfHostedUserSetupCommandResult = await runKubectl([
    'annotate',
    'secret',
    secretName,
    'meta.helm.sh/release-name=compartment',
    `meta.helm.sh/release-namespace=${platformNamespace}`,
  ]);
  expectSuccessfulCommand(annotateSecret, 'annotate retained operator TLS fixture');
  try {
    const retainIdentity: SelfHostedUserSetupCommandResult = await runKubectl([
      'patch',
      'secret/compartment-install-state',
      '--type=merge',
      '--patch',
      JSON.stringify({
        stringData: {
          'active-custom-tls-secret': secretName,
          'operator-custom-tls-secret': secretName,
        },
      }),
    ]);
    expectSuccessfulCommand(retainIdentity, 'retain operator TLS identity');

    await expectSuccessfulOrdinaryHelmUpgrade('apply retained operator TLS state');
    const retainedSecret: SelfHostedUserSetupCommandResult = await runKubectl([
      'get',
      `secret/${secretName}`,
      '--output=jsonpath={.data.tls\\.crt}',
    ]);
    expectSuccessfulCommand(retainedSecret, 'read retained operator TLS Secret after an ordinary upgrade');
    expect(Buffer.from(retainedSecret.stdout, 'base64').toString('utf8')).toBe('test-certificate');
  } finally {
    const clearIdentity: SelfHostedUserSetupCommandResult = await runKubectl([
      'patch',
      'secret/compartment-install-state',
      '--type=merge',
      '--patch',
      JSON.stringify({
        stringData: {
          'active-custom-tls-secret': '',
          'operator-custom-tls-secret': '',
        },
      }),
    ]);
    expectSuccessfulCommand(clearIdentity, 'clear retained operator TLS fixture identity');
    await expectSuccessfulOrdinaryHelmUpgrade('remove retained operator TLS fixture');
    const deleteSecret: SelfHostedUserSetupCommandResult = await runKubectl([
      'delete',
      'secret',
      secretName,
      '--ignore-not-found',
    ]);
    expectSuccessfulCommand(deleteSecret, 'delete retained operator TLS fixture');
  }
}

async function expectSuccessfulOrdinaryHelmUpgrade(description: string): Promise<void> {
  const upgrade: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'helm',
      'upgrade',
      'compartment',
      'deploy/chart/compartment',
      '--namespace',
      platformNamespace,
      '--kube-context',
      platformKubeContext,
      '--values',
      platformValuesPath,
      '--wait',
      '--timeout',
      '10m',
    ],
    timeoutMs: installTimeoutMs,
  });
  expectSuccessfulCommand(upgrade, description);
}

async function expectCleanPodStartup(podName: string, workload: StartupWorkload): Promise<void> {
  const restartCount: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    podName,
    '--output',
    `jsonpath={.status.containerStatuses[?(@.name=="${workload.containerName}")].restartCount}`,
  ]);
  expectSuccessfulCommand(restartCount, `read ${podName} restart count`);
  expect(restartCount.stdout.trim(), `${podName} application container restarted during startup.`).toBe('0');

  const logs: SelfHostedUserSetupCommandResult = await runKubectl([
    'logs',
    podName,
    '--container',
    workload.containerName,
  ]);
  expectSuccessfulCommand(logs, `read ${podName} startup logs`);
  const startupErrors: readonly string[] = logs.stdout
    .split('\n')
    .filter((line: string): boolean => isLevelError(line) || line.includes('ECONNREFUSED'));
  expect(startupErrors, `${podName} emitted startup errors:\n${logs.stdout}`).toEqual([]);
}

async function runKubectl(args: readonly string[]): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: ['kubectl', '--context', platformKubeContext, '--namespace', platformNamespace, ...args],
    timeoutMs: kubernetesCommandTimeoutMs,
  });
}

function isLevelError(line: string): boolean {
  try {
    const record: JsonValue = JSON.parse(line) as JsonValue;
    if (typeof record !== 'object' || record === null || Array.isArray(record) || !('level' in record)) {
      return false;
    }
    const level: JsonValue | undefined = record.level;
    return typeof level === 'number' && level >= 50;
  } catch {
    return false;
  }
}
