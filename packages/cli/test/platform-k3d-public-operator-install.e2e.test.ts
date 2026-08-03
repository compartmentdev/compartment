import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installResponseSchema, type InstallResponse } from '@compartment/contracts';
import { readSocketSafeTempRootDirectory } from '@compartment/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertBuiltCliAvailable,
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';
import { buildSelfHostedUserSetupClientEnv } from './self-hosted-user-setup-client-env.harness';
import { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';

const platformModeEnvName: string = 'COMPARTMENT_E2E_PLATFORM_MODE';
const baseDomain: string = 'apps.example.test';
const releaseName: string = 'public-operator';
const namespace: string = 'compartment-public-operator';
const organizationName: string = 'Public Operator E2E';
const organizationSlug: string = 'public-operator-e2e';
const kubeContext: string = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e-managed-install';
const managedNamespace: string = process.env.COMPARTMENT_E2E_MANAGED_NAMESPACE ?? 'compartment-managed-managed-install';
const buildNamespace: string = `${managedNamespace}-public-operator-build`;
const projectProvisioningNamespace: string = `${releaseName}-compartment-project-provisioning`;
const httpPort: string = process.env.COMPARTMENT_E2E_HTTP_PORT ?? '18080';
const apiUrl: string = `http://console.${baseDomain}:${httpPort}`;
const valuesPath: string =
  process.env.COMPARTMENT_E2E_PUBLIC_OPERATOR_VALUES_PATH ?? '.compartment/platform-k3d-public-operator-values.yaml';
const installTimeoutMs: number = 50 * 60_000;
const commandTimeoutMs: number = 6 * 60_000;
const tempRootDirectory: string = readSocketSafeTempRootDirectory('pk3p-', 'system-api.sock');
const createdDirectories: string[] = [];

describe.sequential('production public operator-domain Kubernetes install', (): void => {
  if (process.env[platformModeEnvName] !== 'k3d') {
    it(`requires ${platformModeEnvName}=k3d`, (): void => {
      expect(process.env[platformModeEnvName]).toBe('k3d');
    });
    return;
  }

  beforeAll(async (): Promise<void> => await assertBuiltCliAvailable());
  afterAll(async (): Promise<void> => {
    await cleanupPublicOperatorInstall();
    await Promise.all(
      createdDirectories
        .splice(0)
        .map(async (directory: string): Promise<void> => await rm(directory, { force: true, recursive: true })),
    );
  }, commandTimeoutMs);

  it('rejects public operator values without a registry issuer before Helm', async (): Promise<void> => {
    const directory: string = await createTemporaryDirectory();
    const incompleteValuesPath: string = join(directory, 'incomplete-values.yaml');
    await writeFile(incompleteValuesPath, 'ingress:\n  className: traefik\nstorage:\n  storageClass: local-path\n', {
      mode: 0o600,
    });
    const installerCli: SelfHostedUserSetupCli = await createFreshCli();
    const failure: SelfHostedUserSetupCommandResult = await installerCli.runFailure(
      buildInstallCommand(incompleteValuesPath, 'negative-owner@example.test'),
    );
    const output: string = `${failure.stderr}\n${failure.stdout}`;

    expect(output).toContain(`${incompleteValuesPath}: registry.issuerRef: is required because the private registry`);
    expect(output).not.toMatch(/ZodError|"code"|"expected"|"received"|at parse/u);
    const helmRelease: SelfHostedUserSetupCommandResult = await runHelm([
      'status',
      releaseName,
      '--namespace',
      namespace,
    ]);
    expect(helmRelease.exitCode).not.toBe(0);
    const namespaceLookup: SelfHostedUserSetupCommandResult = await runKubectlWithoutNamespace([
      'get',
      `namespace/${namespace}`,
    ]);
    expect(namespaceLookup.exitCode).not.toBe(0);
  });

  it(
    'installs a public operator domain through shared Ingress and retains derived TLS state',
    async (): Promise<void> => {
      const ownerEmail: string = `public-operator-${randomUUID()}@example.test`;
      const ownerPassword: string = `PublicOperator-${randomBytes(24).toString('base64url')}!`;
      const installerCli: SelfHostedUserSetupCli = await createFreshCli(ownerPassword);
      const result: InstallResponse = await installerCli.runJson(
        buildInstallCommand(valuesPath, ownerEmail),
        installResponseSchema,
      );

      expect(result.adminEmail).toBe(ownerEmail);
      expect(result.compartmentUrl).toBe(`http://console.${baseDomain}`);
      expect(result.organization.slug).toBe(organizationSlug);
      await expectNoPlatformCertificates();
      await expectDerivedIngressHosts();
      await expectDerivedRegistryTls();
      await expectCaddyBehindSharedIngress();
      await expectRetainedInstallState();
    },
    installTimeoutMs,
  );
});

function buildInstallCommand(selectedValuesPath: string, ownerEmail: string): string {
  return `install --api-url ${apiUrl} --base-domain ${baseDomain} --values ${selectedValuesPath} --kube-context ${kubeContext} --namespace ${namespace} --release-name ${releaseName} --email ${ownerEmail} --organization "${organizationName}" --organization-slug ${organizationSlug}`;
}

async function createFreshCli(adminPassword?: string): Promise<SelfHostedUserSetupCli> {
  const homeDirectory: string = await createTemporaryDirectory();
  const env: NodeJS.ProcessEnv = buildSelfHostedUserSetupClientEnv(homeDirectory);
  if (adminPassword !== undefined) {
    env.COMPARTMENT_ADMIN_PASSWORD = adminPassword;
  }
  return new SelfHostedUserSetupCli(env, installTimeoutMs);
}

async function createTemporaryDirectory(): Promise<string> {
  const directory: string = await mkdtemp(join(tempRootDirectory, 'client-'));
  createdDirectories.push(directory);
  return directory;
}

async function expectNoPlatformCertificates(): Promise<void> {
  const names: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    'certificate',
    '--selector',
    `app.kubernetes.io/instance=${releaseName},app.kubernetes.io/component=platform-tls`,
    '--output=name',
  ]);
  expectSuccessfulCommand(names, 'list public platform Certificates');
  expect(names.stdout.trim()).toBe('');
}

async function expectDerivedIngressHosts(): Promise<void> {
  const hosts: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    `ingress/${releaseName}-compartment`,
    '--output=jsonpath={.spec.rules[*].host}',
  ]);
  expectSuccessfulCommand(hosts, 'read public operator Ingress hosts');
  const compareHosts: (left: string, right: string) => number = (left: string, right: string): number =>
    left.localeCompare(right);
  expect(hosts.stdout.trim().split(' ').sort(compareHosts)).toEqual(
    [`*.${baseDomain}`, `console.${baseDomain}`].sort(compareHosts),
  );
}

async function expectDerivedRegistryTls(): Promise<void> {
  const expectedHostname: string = [10, 43, 250, 250].join('.');
  const certificate: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    `certificate/${releaseName}-compartment-registry`,
    '--output=jsonpath={.spec.ipAddresses[0]}',
  ]);
  expectSuccessfulCommand(certificate, 'read the derived registry Certificate hostname');
  expect(certificate.stdout).toBe(expectedHostname);
  const workerHostname: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    `configmap/${releaseName}-compartment`,
    '--output=jsonpath={.data.COMPARTMENT_ARTIFACT_REGISTRY_HOST}',
  ]);
  expectSuccessfulCommand(workerHostname, 'read the derived worker registry hostname');
  expect(workerHostname.stdout).toBe(expectedHostname);
}

async function expectCaddyBehindSharedIngress(): Promise<void> {
  const serviceType: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    `service/${releaseName}-compartment-caddy`,
    '--output=jsonpath={.spec.type}',
  ]);
  expectSuccessfulCommand(serviceType, 'read the public operator Caddy Service type');
  expect(serviceType.stdout).toBe('ClusterIP');
}

async function expectRetainedInstallState(): Promise<void> {
  const retainedDomain: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    `secret/${releaseName}-install-state`,
    '--output=jsonpath={.data.base-domain}',
  ]);
  expectSuccessfulCommand(retainedDomain, 'read retained public operator install state');
  expect(Buffer.from(retainedDomain.stdout, 'base64').toString('utf8')).toBe(baseDomain);
}

async function cleanupPublicOperatorInstall(): Promise<void> {
  const status: SelfHostedUserSetupCommandResult = await runHelm(['status', releaseName, '--namespace', namespace]);
  if (status.exitCode === 0) {
    expectSuccessfulCommand(
      await runHelm(['uninstall', releaseName, '--namespace', namespace, '--wait', '--timeout', '4m']),
      'uninstall the public operator release',
    );
  } else {
    expect(`${status.stderr}\n${status.stdout}`).toMatch(/release: not found|release not found/iu);
  }
  expectSuccessfulCommand(
    await runKubectlWithoutNamespace([
      'delete',
      `namespace/${namespace}`,
      `namespace/${buildNamespace}`,
      `namespace/${projectProvisioningNamespace}`,
      '--ignore-not-found',
      '--wait=true',
      '--timeout=4m',
    ]),
    'delete public operator namespaces',
  );
  for (const resource of publicOperatorClusterResources()) {
    const lookup: SelfHostedUserSetupCommandResult = await runKubectlWithoutNamespace(['get', resource]);
    expect(lookup.exitCode, `${resource} remained after public operator cleanup.`).not.toBe(0);
    expect(`${lookup.stderr}\n${lookup.stdout}`).toMatch(/notfound|not found/iu);
  }
}

function publicOperatorClusterResources(): readonly string[] {
  const fullname: string = `${releaseName}-compartment`;
  return [
    'priorityclass/compartment-platform',
    'priorityclass/compartment-tenant',
    'clusterrole/compartment-controller',
    'clusterrole/compartment-project-bootstrap',
    `clusterrole/${fullname}-project-provisioner`,
    `clusterrolebinding/${fullname}-project-provisioner`,
    `validatingadmissionpolicy/${fullname}-project-bootstrap-boundary`,
    `validatingadmissionpolicybinding/${fullname}-project-bootstrap-boundary`,
  ];
}

async function runKubectl(args: readonly string[]): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: ['kubectl', '--context', kubeContext, '--namespace', namespace, ...args],
    timeoutMs: commandTimeoutMs,
  });
}

async function runKubectlWithoutNamespace(args: readonly string[]): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: ['kubectl', '--context', kubeContext, ...args],
    timeoutMs: commandTimeoutMs,
  });
}

async function runHelm(args: readonly string[]): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: ['helm', '--kube-context', kubeContext, ...args],
    timeoutMs: commandTimeoutMs,
  });
}
