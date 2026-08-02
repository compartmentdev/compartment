import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  installResponseSchema,
  issuePasswordResetResponseSchema,
  kubernetesSystemRestartResponseSchema,
  kubernetesSystemStatusResponseSchema,
  systemDomainStatusResponseSchema,
  whoamiCommandResponseSchema,
  type InstallResponse,
  type IssuePasswordResetResponse,
  type KubernetesSystemRestartResponse,
  type KubernetesSystemStatusResponse,
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
const platformApiUrl: string = process.env.COMPARTMENT_E2E_API_URL ?? 'http://console.compartment.localhost:18080';
const platformCompartmentUrl: string = 'http://console.compartment.localhost';
const platformBaseDomain: string = 'compartment.localhost';
const platformOrganizationName: string = 'Platform E2E';
const platformOrganizationSlug: string = 'platform-e2e';
const platformValuesPath: string =
  process.env.COMPARTMENT_E2E_PLATFORM_VALUES_PATH ?? '.compartment/platform-k3d-e2e-values.yaml';
const platformKubeContext: string = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const platformNamespace: string = process.env.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? 'compartment';
const platformIngressClass: string = process.env.COMPARTMENT_E2E_INGRESS_CLASS ?? 'traefik';
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

interface ForwardedMetadataEcho {
  readonly headers: Record<string, string | string[] | undefined>;
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
      const installerCli: SelfHostedUserSetupCli = await createFreshCli(ownerPassword);
      const result: InstallResponse = await installerCli.runJson(
        `install --api-url ${platformApiUrl} --base-domain ${platformBaseDomain} --values ${platformValuesPath} --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name compartment --email ${ownerEmail} --organization "${platformOrganizationName}" --organization-slug ${platformOrganizationSlug}`,
        installResponseSchema,
      );

      await expectCleanControllerStartup();
      await expectPlatformRuntime();
      await expectOperatorRegistryInstallValues();
      await expectIngressControllerCompatibility();
      await expectRegistryPodRecovery();
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
        `system domain status --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name compartment`,
        systemDomainStatusResponseSchema,
      );
      expect(domainStatus.active.baseDomain).toBe(platformBaseDomain);

      const platformStatus: KubernetesSystemStatusResponse = await installerCli.runJson(
        `system status --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name compartment`,
        kubernetesSystemStatusResponseSchema,
      );
      expect(platformStatus.ready).toBe(true);
      expect(platformStatus.workloads.length).toBeGreaterThan(0);

      const platformRestart: KubernetesSystemRestartResponse = await installerCli.runJson(
        `system restart --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name compartment`,
        kubernetesSystemRestartResponseSchema,
      );
      expect(platformRestart.restarted).toBe(true);

      const reset: IssuePasswordResetResponse = await installerCli.runJson(
        `system issue-password-reset --email ${ownerEmail} --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name compartment`,
        issuePasswordResetResponseSchema,
      );
      expect(reset.email).toBe(ownerEmail);
      expect(reset.resetToken).not.toBe('');

      await expectForwardedMetadataSpoofingRejected();
      await expectRetainedDomainGenerationProtection();
    },
    installTimeoutMs,
  );
});

async function createFreshCli(adminPassword?: string): Promise<SelfHostedUserSetupCli> {
  const homeDirectory: string = await mkdtemp(join(tempRootDirectory, 'client-'));
  createdDirectories.push(homeDirectory);
  const env: NodeJS.ProcessEnv = buildSelfHostedUserSetupClientEnv(homeDirectory);
  if (adminPassword !== undefined) {
    env.COMPARTMENT_ADMIN_PASSWORD = adminPassword;
  }
  return new SelfHostedUserSetupCli(env, installTimeoutMs);
}

async function expectOperatorRegistryInstallValues(): Promise<void> {
  const expectedHostname: string = [10, 43, 250, 250].join('.');
  const configuredHostname: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    'configmap/compartment-compartment',
    '--output=jsonpath={.data.COMPARTMENT_ARTIFACT_REGISTRY_HOST}',
  ]);
  expectSuccessfulCommand(configuredHostname, 'read the worker registry hostname');
  expect(configuredHostname.stdout).toBe(expectedHostname);

  const retainedHostname: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    'secret/compartment-install-state',
    '--output=jsonpath={.data.registry-hostname}',
  ]);
  expectSuccessfulCommand(retainedHostname, 'read the retained registry hostname');
  expect(Buffer.from(retainedHostname.stdout, 'base64').toString('utf8')).toBe(expectedHostname);

  const certificateHostname: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    'certificate/compartment-compartment-registry',
    '--output=jsonpath={.spec.ipAddresses[0]}',
  ]);
  expectSuccessfulCommand(certificateHostname, 'read the registry Certificate hostname');
  expect(certificateHostname.stdout).toBe(expectedHostname);

  const ingressHosts: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    'ingress/compartment-compartment',
    '--output=jsonpath={.spec.rules[*].host}',
  ]);
  expectSuccessfulCommand(ingressHosts, 'read public Ingress hosts');
  expect(ingressHosts.stdout.split(' ')).not.toContain(expectedHostname);
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

async function expectPlatformRuntime(): Promise<void> {
  if (process.env.COMPARTMENT_E2E_GVISOR_ENABLED !== '1') {
    return;
  }
  const version: SelfHostedUserSetupCommandResult = await runKubectl([
    'exec',
    'deployment/compartment-compartment-api',
    '--',
    'cat',
    '/proc/version',
  ]);
  expectSuccessfulCommand(version, 'read the platform API kernel version');
  expect(version.stdout.toLowerCase()).not.toContain('gvisor');
}

async function expectIngressControllerCompatibility(): Promise<void> {
  await expectSuccessfulKubectl(['get', `ingressclass/${platformIngressClass}`], 'read the selected IngressClass');
  if (platformIngressClass !== 'nginx') {
    return;
  }

  const traefik: SelfHostedUserSetupCommandResult = await runKubectl([
    '--namespace',
    'kube-system',
    'get',
    'deployment/traefik',
    '--output=jsonpath={.status.availableReplicas}',
  ]);
  expectSuccessfulCommand(traefik, 'verify Traefik remains available beside ingress-nginx');
  expect(Number(traefik.stdout)).toBeGreaterThan(0);

  const nodes: SelfHostedUserSetupCommandResult = await runKubectl(['get', 'nodes', '--output=name']);
  expectSuccessfulCommand(nodes, 'list the multi-node compatibility cluster');
  expect(nodes.stdout.trim().split('\n')).toHaveLength(2);
}

async function expectRegistryPodRecovery(): Promise<void> {
  if (platformIngressClass !== 'nginx') {
    return;
  }

  const registryName: string = 'compartment-compartment-registry';
  const originalClaimUid: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    `persistentvolumeclaim/${registryName}`,
    '--output=jsonpath={.metadata.uid}',
  ]);
  expectSuccessfulCommand(originalClaimUid, 'read the registry PVC identity before recovery');
  const originalRepository: SelfHostedUserSetupCommandResult = await runKubectl([
    'exec',
    `deployment/${registryName}`,
    '--',
    'sh',
    '-c',
    'find /var/lib/registry/docker/registry/v2/repositories -type d -name _manifests | head -n 1',
  ]);
  expectSuccessfulCommand(originalRepository, 'read the persisted registry acceptance repository');
  expect(originalRepository.stdout.trim()).not.toBe('');

  await expectSuccessfulKubectl(['rollout', 'restart', `deployment/${registryName}`], 'restart the registry Pod');
  await expectSuccessfulKubectl(
    ['rollout', 'status', `deployment/${registryName}`, '--timeout=6m'],
    'wait for registry Pod recovery',
  );

  const recoveredClaimUid: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    `persistentvolumeclaim/${registryName}`,
    '--output=jsonpath={.metadata.uid}',
  ]);
  expectSuccessfulCommand(recoveredClaimUid, 'read the registry PVC identity after recovery');
  expect(recoveredClaimUid.stdout).toBe(originalClaimUid.stdout);
  const recoveredRepository: SelfHostedUserSetupCommandResult = await runKubectl([
    'exec',
    `deployment/${registryName}`,
    '--',
    'sh',
    '-c',
    'find /var/lib/registry/docker/registry/v2/repositories -type d -name _manifests | head -n 1',
  ]);
  expectSuccessfulCommand(recoveredRepository, 'read registry data after Pod and PVC recovery');
  expect(recoveredRepository.stdout).toBe(originalRepository.stdout);
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

async function expectForwardedMetadataSpoofingRejected(): Promise<void> {
  const echoName: string = 'forwarded-metadata-echo';
  const caddyName: string = 'forwarded-metadata-caddy';
  const ingressName: string = 'forwarded-metadata-ingress';
  const testBaseDomain: string = 'forwarded.compartment.localhost';
  const testHost: string = `console.${testBaseDomain}`;
  const apiImage: string = await readDeploymentImage('compartment-compartment-api');
  const caddyImage: string = await readDeploymentImage('compartment-compartment-caddy');
  const echoProgram: string =
    "require('node:http').createServer((request,response)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify({headers:request.headers}));}).listen(3999,'0.0.0.0')";
  try {
    await expectSuccessfulKubectl(
      [
        'run',
        echoName,
        `--image=${apiImage}`,
        '--port=3999',
        '--labels=app.kubernetes.io/name=forwarded-metadata-echo',
        '--command',
        '--',
        'node',
        '-e',
        echoProgram,
      ],
      'create forwarded metadata echo Pod',
    );
    await expectSuccessfulKubectl(
      ['expose', 'pod', echoName, `--name=${echoName}`, '--port=3999', '--target-port=3999'],
      'create forwarded metadata echo Service',
    );
    await expectSuccessfulKubectl(
      [
        'run',
        caddyName,
        `--image=${caddyImage}`,
        '--port=8080',
        `--labels=app.kubernetes.io/name=compartment,app.kubernetes.io/instance=compartment,app.kubernetes.io/component=caddy,compartment.dev/test=${caddyName}`,
        `--env=COMPARTMENT_BASE_DOMAIN=${testBaseDomain}`,
        `--env=COMPARTMENT_API_INTERNAL_HOST=${echoName}`,
        '--env=COMPARTMENT_API_PORT=3999',
        '--env=COMPARTMENT_CADDY_HTTP_PORT=8080',
        '--env=COMPARTMENT_EDGE_APP_REQUESTS_PER_SECOND=300',
        '--env=COMPARTMENT_EDGE_APP_BURST=600',
        '--env=COMPARTMENT_EDGE_APP_IN_FLIGHT=512',
        '--env=COMPARTMENT_EDGE_CLIENT_REQUESTS_PER_SECOND=60',
        '--env=COMPARTMENT_EDGE_CLIENT_BURST=120',
        '--env=COMPARTMENT_EDGE_INTERNAL_HOST=unused-edge',
        '--env=COMPARTMENT_EDGE_PORT=39081',
        '--env=COMPARTMENT_EDGE_TOKEN=test-edge-token',
        '--env=COMPARTMENT_USAGE_METERING_INTERVAL_MS=60000',
      ],
      'create forwarded metadata Caddy Pod',
    );
    await expectSuccessfulKubectl(
      ['expose', 'pod', caddyName, `--name=${caddyName}`, '--port=8080', '--target-port=8080'],
      'create forwarded metadata Caddy Service',
    );
    await expectSuccessfulKubectl(
      ['create', 'ingress', ingressName, `--class=${platformIngressClass}`, `--rule=${testHost}/=${caddyName}:8080`],
      'create forwarded metadata test Ingress',
    );
    await expectSuccessfulKubectl(
      ['wait', `pod/${echoName}`, `pod/${caddyName}`, '--for=condition=Ready', '--timeout=4m'],
      'wait for forwarded metadata test Pods',
    );

    const metadata: ForwardedMetadataEcho = await readForwardedMetadataEcho(testHost);
    const expectedUpstreamHost: URL = new URL(platformApiUrl);
    expectedUpstreamHost.hostname = testHost;
    expect(metadata.headers.host).toBe(expectedUpstreamHost.host);
    expect(metadata.headers['x-forwarded-host']).toBe(testHost);
    expect(metadata.headers['x-forwarded-proto']).toBe('http');
    expect(metadata.headers['x-forwarded-for']).not.toContain('203.0.113.77');
    expect(metadata.headers.forwarded).toBeUndefined();
  } finally {
    await runKubectl([
      'delete',
      `ingress/${ingressName}`,
      `service/${caddyName}`,
      `service/${echoName}`,
      `pod/${caddyName}`,
      `pod/${echoName}`,
      '--ignore-not-found',
      '--wait=true',
      '--timeout=4m',
    ]);
  }
}

async function readDeploymentImage(deploymentName: string): Promise<string> {
  const result: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    `deployment/${deploymentName}`,
    '--output=jsonpath={.spec.template.spec.containers[0].image}',
  ]);
  expectSuccessfulCommand(result, `read ${deploymentName} image`);
  expect(result.stdout.trim()).not.toBe('');
  return result.stdout.trim();
}

async function readForwardedMetadataEcho(host: string): Promise<ForwardedMetadataEcho> {
  const url: URL = new URL(platformApiUrl);
  url.hostname = host;
  url.pathname = '/';
  const deadline: number = Date.now() + 60_000;
  for (;;) {
    try {
      const response: Response = await fetch(url, {
        headers: {
          Forwarded: 'for=203.0.113.77;host=attacker.example;proto=https',
          'X-Forwarded-For': '203.0.113.77',
          'X-Forwarded-Host': 'attacker.example',
          'X-Forwarded-Proto': 'https',
        },
        redirect: 'manual',
      });
      if (response.ok) {
        return (await response.json()) as ForwardedMetadataEcho;
      }
    } catch {
      // The Ingress route can lag Pod readiness briefly.
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the forwarded metadata test route.');
    }
    await new Promise<void>((resolveDelay: () => void): void => {
      setTimeout(resolveDelay, 500);
    });
  }
}

async function expectSuccessfulKubectl(args: readonly string[], description: string): Promise<void> {
  expectSuccessfulCommand(await runKubectl(args), description);
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
