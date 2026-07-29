import { X509Certificate } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { get } from 'node:https';
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
const managedAcmeManagementPort: number = Number(process.env.COMPARTMENT_E2E_MANAGED_ACME_PORT ?? '19500');
const managedAcmeManagementTimeoutMs: number = 30_000;
const managedBrokerServicePort: number = 19_000;

const managedBrokerHostPort: number = Number(process.env.COMPARTMENT_E2E_MANAGED_BROKER_PORT ?? '19000');

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

interface ManagedDomainAllocationObservation {
  readonly allocationId: string;
  readonly installationId: string;
  readonly requestedLabelSource: string;
  readonly targets: readonly ManagedDomainTargetObservation[];
}

export interface ManagedDomainBrokerObservation {
  readonly allocations: readonly ManagedDomainAllocationObservation[];
  readonly audit: readonly ManagedDomainAuditObservation[];
  readonly replayCount: number;
}

interface ManagedDomainTargetObservation {
  readonly type: 'A' | 'AAAA' | 'hostname';
  readonly value: string;
}

export interface ManagedDomainAuditObservation {
  readonly event: string;
}

export async function prepareManagedInstallFixture(): Promise<void> {
  if (managedBrokerHostPort !== managedBrokerServicePort) {
    throw new Error('Managed install e2e requires its broker host port to match Service port 19000.');
  }
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

export async function renewManagedInstallConsoleCertificate(): Promise<void> {
  const certificateName: string = `${managedInstallReleaseName}-compartment-console`;
  const secretName: string = `${certificateName}-tls`;
  const originalSerialNumber: string = await readManagedInstallCertificateSerialNumber(secretName);
  await expectSuccessfulKubectl(
    ['--namespace', managedInstallNamespace, 'delete', `secret/${secretName}`, '--wait=true'],
    'remove the managed console TLS Secret to trigger renewal',
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
    'wait for managed console certificate renewal',
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
      throw new Error('Managed console certificate renewal did not replace the certificate before the timeout.');
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
  const managementCa: Buffer = await readFile(
    resolve(repositoryRoot, process.env.COMPARTMENT_E2E_PEBBLE_CA_PATH ?? '.compartment/pebble.minica.pem'),
  );
  const rootCertificate: Buffer = await readManagedInstallCertificateAuthorityWithRetry(managementCa);
  const certificate: X509Certificate = new X509Certificate(rootCertificate);
  if (certificate.ca !== true || certificate.checkIssued(certificate) !== true) {
    throw new Error('Pebble root endpoint did not return a self-issued CA certificate.');
  }
  await writeFile(managedInstallCertificateAuthorityPath, rootCertificate, { mode: 0o600 });
}

async function readManagedInstallCertificateAuthorityWithRetry(managementCa: Buffer): Promise<Buffer> {
  const deadline: number = Date.now() + managedAcmeManagementTimeoutMs;
  for (;;) {
    try {
      return await readManagedInstallCertificateAuthority(managementCa);
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await delay(500);
    }
  }
}

async function readManagedInstallCertificateAuthority(managementCa: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>(
    (resolveCertificate: (certificate: Buffer) => void, rejectCertificate: (error: Error) => void): void => {
      const request: ClientRequest = get(
        {
          ca: managementCa,
          host: '127.0.0.1',
          path: '/roots/0',
          port: managedAcmeManagementPort,
          rejectUnauthorized: true,
          servername: 'localhost',
        },
        (response: IncomingMessage): void => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer): void => {
            chunks.push(chunk);
          });
          response.once('end', (): void => {
            if (response.statusCode !== 200) {
              rejectCertificate(new Error(`Pebble root endpoint returned HTTP ${response.statusCode ?? 'unknown'}.`));
              return;
            }
            resolveCertificate(Buffer.concat(chunks));
          });
        },
      );
      request.setTimeout(5_000, (): void => {
        request.destroy(new Error('Timed out reading the Pebble root certificate.'));
      });
      request.once('error', rejectCertificate);
    },
  );
}

export async function waitForManagedDomainBrokerObservation(): Promise<ManagedDomainBrokerObservation> {
  const deadline: number = Date.now() + brokerStateTimeoutMs;
  for (;;) {
    const response: Response = await fetch(`http://127.0.0.1:${managedBrokerHostPort.toString()}/__test/state`);
    if (response.ok) {
      const observation: ManagedDomainBrokerObservation = (await response.json()) as ManagedDomainBrokerObservation;
      if (observation.allocations.length === 1) {
        return observation;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for managed-domain allocation.');
    }
    await delay(500);
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
