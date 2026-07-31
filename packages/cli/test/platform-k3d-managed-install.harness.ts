import { X509Certificate } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

const repositoryRoot: string = resolve(__dirname, '../../..');
const fixtureDirectory: string = resolve(repositoryRoot, 'deploy/e2e/managed-install');
const kubernetesTimeoutMs: number = 6 * 60_000;
const brokerStateTimeoutMs: number = 60_000;
const managedBrokerServicePort: number = 19_000;
const managedBrokerPortForwardTimeoutMs: number = 30_000;
const managedBrokerPortForwardTerminateTimeoutMs: number = 5_000;
const managedBrokerPortForwardKillDelayMs: number = 3_000;
let managedBrokerPortForward: ChildProcessWithoutNullStreams | undefined;
type PromiseReject = (reason?: Error) => void;
type PromiseResolveVoid = (value: void | PromiseLike<void>) => void;

export const managedInstallApiUrl: string = `https://console.managed-platform-e2e.managed.compartment.localhost:${process.env.COMPARTMENT_E2E_HTTPS_PORT ?? '18443'}`;
export const managedInstallBaseDomain: string = 'managed-platform-e2e.managed.compartment.localhost';
export const managedInstallBrokerUrl: string = `http://managed-domain-broker:${managedBrokerServicePort.toString()}`;
export const managedInstallCertificateAuthorityPath: string = resolve(
  repositoryRoot,
  process.env.COMPARTMENT_E2E_PEBBLE_ROOT_PATH ?? '.compartment/pebble.root.pem',
);
export const managedInstallKubeContext: string = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
export const managedInstallNamespace: string =
  process.env.COMPARTMENT_E2E_MANAGED_NAMESPACE ?? 'compartment-managed-e2e';
const managedBuildNamespace: string = `${managedInstallNamespace}-build`;
export const managedInstallReleaseName: string = 'managed-e2e';
export const managedInstallValuesPath: string =
  process.env.COMPARTMENT_E2E_MANAGED_VALUES_PATH ?? '.compartment/platform-k3d-managed-e2e-values.yaml';

interface ManagedDomainObservation {
  readonly installationId: string;
  readonly publicIp: string;
  readonly requestedLabelSource: string;
  readonly targets: readonly ManagedDomainTargetObservation[];
}

export interface ManagedInstallBrokerState {
  chartUrl: string;
  registryHostname: string;
  retainedUrl: string;
}

interface ManagedInstallHelmValues {
  platform?: ManagedInstallHelmPlatformValues | undefined;
  registry?: ManagedInstallHelmRegistryValues | undefined;
}

interface ManagedInstallHelmPlatformValues {
  managedDomainBrokerUrl?: string | undefined;
}

interface ManagedInstallHelmRegistryValues {
  hostname?: string | undefined;
}

export interface ManagedDomainBrokerObservation {
  readonly managedDomains: readonly ManagedDomainObservation[];
  readonly audit: readonly ManagedDomainAuditObservation[];
}

interface ManagedDomainTargetObservation {
  readonly type: 'A' | 'AAAA' | 'hostname';
  readonly value: string;
}

export interface ManagedDomainAuditObservation {
  readonly event: string;
  readonly name?: string | undefined;
}

export async function prepareManagedInstallFixture(): Promise<void> {
  await cleanupManagedInstallFixture();
  await expectSuccessfulKubectl(['create', 'namespace', managedInstallNamespace], 'create managed e2e namespace');
  await expectSuccessfulKubectl(
    [
      '--namespace',
      managedInstallNamespace,
      'create',
      'configmap',
      'managed-domain-broker-fixture',
      `--from-file=broker.mjs=${resolve(fixtureDirectory, 'broker.mjs')}`,
    ],
    'create managed-domain broker fixture',
  );
  await expectSuccessfulKubectl(
    ['--namespace', managedInstallNamespace, 'apply', '--filename', resolve(fixtureDirectory, 'manifests.yaml')],
    'apply managed install fixtures',
  );
  await configureCertManagerRecursiveDns();
  await expectSuccessfulKubectl(
    [
      '--namespace',
      managedInstallNamespace,
      'wait',
      'deployment',
      '--all',
      '--for=condition=Available',
      '--timeout=4m',
    ],
    'wait for managed install fixtures',
  );
  await writeManagedInstallCertificateAuthority();
  await installManagedInstallNodeCertificateTrust();
  await startManagedBrokerPortForward();
}

async function installManagedInstallNodeCertificateTrust(): Promise<void> {
  const nodes: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    'nodes',
    '--output',
    'jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}',
  ]);
  expectSuccessfulCommand(nodes, 'read managed install node names');
  const nodeNames: string[] = nodes.stdout
    .split('\n')
    .map((name: string): string => name.trim())
    .filter((name: string): boolean => name !== '');
  if (nodeNames.length === 0) {
    throw new Error('Managed install fixture requires at least one Kubernetes node.');
  }
  for (const nodeName of nodeNames) {
    const registryServer: string = `https://registry.${managedInstallBaseDomain}:443`;
    const containerdRegistryDirectory: string = `/var/lib/rancher/k3s/agent/etc/containerd/certs.d/registry.${managedInstallBaseDomain}:443`;
    const nodeCertificateAuthorityPath: string = `${containerdRegistryDirectory}/ca.crt`;
    const createRegistryDirectory: SelfHostedUserSetupCommandResult = await runCommand({
      argv: ['docker', 'exec', nodeName, 'mkdir', '-p', containerdRegistryDirectory],
      timeoutMs: kubernetesTimeoutMs,
    });
    expectSuccessfulCommand(createRegistryDirectory, `create the managed registry trust directory on ${nodeName}`);
    const installCertificateAuthority: SelfHostedUserSetupCommandResult = await runCommand({
      argv: ['docker', 'cp', managedInstallCertificateAuthorityPath, `${nodeName}:${nodeCertificateAuthorityPath}`],
      timeoutMs: kubernetesTimeoutMs,
    });
    expectSuccessfulCommand(installCertificateAuthority, `install the managed certificate authority on ${nodeName}`);
    const installRegistryTrustConfiguration: SelfHostedUserSetupCommandResult = await runCommand({
      argv: [
        'docker',
        'exec',
        nodeName,
        'sh',
        '-c',
        `printf '%s\\n' 'server = "${registryServer}"' '[host."${registryServer}"]' '  capabilities = ["pull", "resolve"]' '  ca = "${nodeCertificateAuthorityPath}"' > ${containerdRegistryDirectory}/hosts.toml`,
      ],
      timeoutMs: kubernetesTimeoutMs,
    });
    expectSuccessfulCommand(installRegistryTrustConfiguration, `configure managed registry trust on ${nodeName}`);
  }
}

async function configureCertManagerRecursiveDns(): Promise<void> {
  const dnsService: SelfHostedUserSetupCommandResult = await runKubectl([
    '--namespace',
    managedInstallNamespace,
    'get',
    'service/managed-dns-public-resolvers',
    '--output',
    'jsonpath={.spec.clusterIP}',
  ]);
  expectSuccessfulCommand(dnsService, 'read managed install DNS service address');
  const dnsServiceIp: string = dnsService.stdout.trim();
  if (isIP(dnsServiceIp) === 0) {
    throw new Error(`Managed install DNS service returned an invalid clusterIP: ${dnsServiceIp}`);
  }
  await expectSuccessfulKubectl(
    [
      '--namespace',
      'cert-manager',
      'patch',
      'deployment/cert-manager',
      '--type=json',
      '--patch',
      JSON.stringify([
        {
          op: 'add',
          path: '/spec/template/spec/containers/0/args/-',
          value: '--dns01-recursive-nameservers-only',
        },
        {
          op: 'add',
          path: '/spec/template/spec/containers/0/args/-',
          value: `--dns01-recursive-nameservers=${dnsServiceIp}:53`,
        },
      ]),
    ],
    'configure cert-manager recursive DNS',
  );
  await expectSuccessfulKubectl(
    ['--namespace', 'cert-manager', 'rollout', 'status', 'deployment/cert-manager', '--timeout=4m'],
    'wait for cert-manager recursive DNS rollout',
  );
}

export async function cleanupManagedInstallFixture(): Promise<void> {
  await stopManagedBrokerPortForward();
  await runCommand({
    argv: [
      'helm',
      'uninstall',
      managedInstallReleaseName,
      '--kube-context',
      managedInstallKubeContext,
      '--namespace',
      managedInstallNamespace,
      '--ignore-not-found',
      '--wait',
    ],
    timeoutMs: kubernetesTimeoutMs,
  });
  await runKubectl([
    'delete',
    'namespace',
    managedInstallNamespace,
    managedBuildNamespace,
    '--ignore-not-found',
    '--wait=true',
    '--timeout=4m',
  ]);
}

async function startManagedBrokerPortForward(): Promise<void> {
  const child: ChildProcessWithoutNullStreams = spawn(
    'kubectl',
    [
      '--context',
      managedInstallKubeContext,
      '--namespace',
      managedInstallNamespace,
      'port-forward',
      'service/managed-domain-broker',
      `${managedBrokerServicePort.toString()}:${managedBrokerServicePort.toString()}`,
      '--address=127.0.0.1',
    ],
    { cwd: repositoryRoot },
  );
  managedBrokerPortForward = child;
  let output: string = '';
  await new Promise<void>((resolvePortForward: PromiseResolveVoid, rejectPortForward: PromiseReject): void => {
    let settled: boolean = false;
    const finish: (error?: Error) => void = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.stdout.off('data', readOutput);
      child.stderr.off('data', readOutput);
      child.off('error', handleError);
      child.off('exit', handleExit);
      if (error !== undefined) {
        if (managedBrokerPortForward === child) {
          managedBrokerPortForward = undefined;
        }
        void terminateManagedBrokerPortForward(child).then(
          (): void => rejectPortForward(error),
          (terminationError: Error): void => rejectPortForward(terminationError),
        );
      } else {
        resolvePortForward();
      }
    };
    const readOutput: (chunk: Buffer) => void = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      if (output.includes(`Forwarding from 127.0.0.1:${managedBrokerServicePort.toString()} -> `)) {
        finish();
      }
    };
    const handleError: (error: Error) => void = (error: Error): void => {
      finish(error);
    };
    const handleExit: (code: number | null, signal: NodeJS.Signals | null) => void = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      finish(
        new Error(
          `Managed-domain broker port-forward exited before becoming ready (code=${String(code)}, signal=${String(signal)}). kubectl output:\n${output.trim()}`,
        ),
      );
    };
    const timeout: NodeJS.Timeout = setTimeout(
      (): void =>
        finish(new Error(`Managed-domain broker port-forward did not become ready. kubectl output:\n${output.trim()}`)),
      managedBrokerPortForwardTimeoutMs,
    );
    child.stdout.on('data', readOutput);
    child.stderr.on('data', readOutput);
    child.once('error', handleError);
    child.once('exit', handleExit);
  });
}

async function stopManagedBrokerPortForward(): Promise<void> {
  const child: ChildProcessWithoutNullStreams | undefined = managedBrokerPortForward;
  managedBrokerPortForward = undefined;
  if (child === undefined) {
    return;
  }
  await terminateManagedBrokerPortForward(child);
}

async function terminateManagedBrokerPortForward(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolveExit: PromiseResolveVoid): void => {
    let settled: boolean = false;
    const finish: () => void = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(killTimeout);
      clearTimeout(terminateTimeout);
      child.off('error', finish);
      child.off('exit', finish);
      child.off('close', finish);
      resolveExit();
    };
    child.once('error', finish);
    child.once('exit', finish);
    child.once('close', finish);
    const killTimeout: NodeJS.Timeout = setTimeout((): void => {
      child.kill('SIGKILL');
    }, managedBrokerPortForwardKillDelayMs);
    const terminateTimeout: NodeJS.Timeout = setTimeout(finish, managedBrokerPortForwardTerminateTimeoutMs);
    child.kill('SIGTERM');
  });
}

export async function readManagedInstallBrokerState(): Promise<ManagedInstallBrokerState> {
  const helmValues: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'helm',
      'get',
      'values',
      managedInstallReleaseName,
      '--kube-context',
      managedInstallKubeContext,
      '--namespace',
      managedInstallNamespace,
      '--output',
      'json',
    ],
    timeoutMs: kubernetesTimeoutMs,
  });
  expectSuccessfulCommand(helmValues, 'read managed install Helm values');
  const retainedUrl: SelfHostedUserSetupCommandResult = await runKubectl([
    '--namespace',
    managedInstallNamespace,
    'get',
    'secret',
    `${managedInstallReleaseName}-install-state`,
    '--output',
    'jsonpath={.data.managed-domain-broker-url}',
  ]);
  expectSuccessfulCommand(retainedUrl, 'read retained managed-domain broker URL');
  const values: ManagedInstallHelmValues = JSON.parse(helmValues.stdout) as ManagedInstallHelmValues;
  return {
    chartUrl: values.platform?.managedDomainBrokerUrl ?? '',
    registryHostname: values.registry?.hostname ?? '',
    retainedUrl: Buffer.from(retainedUrl.stdout, 'base64').toString('utf8'),
  };
}

export async function renewManagedInstallWildcardCertificate(): Promise<void> {
  const certificateName: string = `${managedInstallReleaseName}-compartment-wildcard`;
  const secretName: string = `${certificateName}-tls`;
  const originalSerialNumber: string = await readManagedInstallCertificateSerialNumber(secretName);
  await expectSuccessfulKubectl(
    ['--namespace', managedInstallNamespace, 'delete', `secret/${secretName}`, '--wait=true'],
    'remove the managed wildcard TLS Secret to trigger renewal',
  );
  await expectSuccessfulKubectl(
    [
      '--namespace',
      managedInstallNamespace,
      'wait',
      `certificate/${certificateName}`,
      '--for=condition=Ready',
      '--timeout=4m',
    ],
    'wait for managed wildcard certificate renewal',
  );

  const deadline: number = Date.now() + kubernetesTimeoutMs;
  for (;;) {
    try {
      const renewedSerialNumber: string = await readManagedInstallCertificateSerialNumber(secretName);
      if (renewedSerialNumber !== originalSerialNumber) {
        return;
      }
    } catch {
      // cert-manager replaces the Secret asynchronously.
    }
    if (Date.now() >= deadline) {
      throw new Error('Managed wildcard certificate renewal did not replace the certificate before the timeout.');
    }
    await delay(500);
  }
}

async function readManagedInstallCertificateSerialNumber(secretName: string): Promise<string> {
  const certificate: SelfHostedUserSetupCommandResult = await runKubectl([
    '--namespace',
    managedInstallNamespace,
    'get',
    `secret/${secretName}`,
    '--output=jsonpath={.data.tls\\.crt}',
  ]);
  expectSuccessfulCommand(certificate, `read certificate from ${secretName}`);
  return new X509Certificate(Buffer.from(certificate.stdout, 'base64')).serialNumber;
}

async function writeManagedInstallCertificateAuthority(): Promise<void> {
  const result: SelfHostedUserSetupCommandResult = await runKubectl([
    'get',
    '--raw',
    `/api/v1/namespaces/${managedInstallNamespace}/services/https:pebble:15000/proxy/roots/0`,
  ]);
  expectSuccessfulCommand(result, 'read the Pebble root certificate through the Kubernetes Service proxy');
  const rootCertificate: Buffer = Buffer.from(result.stdout);
  const certificate: X509Certificate = new X509Certificate(rootCertificate);
  if (certificate.ca !== true || certificate.checkIssued(certificate) !== true) {
    throw new Error('Pebble fixture did not provide a self-issued root CA certificate.');
  }
  await writeFile(managedInstallCertificateAuthorityPath, rootCertificate, { mode: 0o600 });
}

export async function waitForManagedDomainBrokerObservation(): Promise<ManagedDomainBrokerObservation> {
  const deadline: number = Date.now() + brokerStateTimeoutMs;
  let lastFailure: string = '';
  for (;;) {
    const result: SelfHostedUserSetupCommandResult = await runKubectl([
      'get',
      '--raw',
      `/api/v1/namespaces/${managedInstallNamespace}/services/http:managed-domain-broker:${managedBrokerServicePort.toString()}/proxy/__test/state`,
    ]);
    if (result.exitCode === 0) {
      const observation: ManagedDomainBrokerObservation = readManagedDomainBrokerObservation(result.stdout);
      if (observation.managedDomains.length === 1) {
        return observation;
      }
    } else {
      const stderr: string = result.stderr.trim();
      lastFailure = stderr !== '' ? stderr : result.stdout.trim();
    }
    if (Date.now() >= deadline) {
      const diagnostic: string = lastFailure !== '' ? ` Last Kubernetes API error: ${lastFailure}` : '';
      throw new Error(`Timed out waiting for managed domain.${diagnostic}`);
    }
    await delay(500);
  }
}

function readManagedDomainBrokerObservation(output: string): ManagedDomainBrokerObservation {
  try {
    return JSON.parse(output) as ManagedDomainBrokerObservation;
  } catch {
    throw new Error('Managed-domain broker state returned invalid JSON.');
  }
}

async function expectSuccessfulKubectl(args: readonly string[], description: string): Promise<void> {
  const result: SelfHostedUserSetupCommandResult = await runKubectl(args);
  expectSuccessfulCommand(result, description);
}

async function runKubectl(args: readonly string[]): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    argv: ['kubectl', '--context', managedInstallKubeContext, ...args],
    timeoutMs: kubernetesTimeoutMs,
  });
}
