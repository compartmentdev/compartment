import { X509Certificate } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { get } from 'node:https';
import { resolve } from 'node:path';
import { connect, type TLSSocket } from 'node:tls';
import { setTimeout as delay } from 'node:timers/promises';
import {
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

const repositoryRoot: string = resolve(__dirname, '../../..');
const fixtureDirectory: string = resolve(repositoryRoot, 'deploy/e2e/managed-install');
const managedBuildNamespace: string = 'compartment-managed-e2e-build';
const kubernetesTimeoutMs: number = 6 * 60_000;
const brokerStateTimeoutMs: number = 60_000;
const managedAcmeManagementPort: number = 19_500;

export const managedInstallApiUrl: string = 'https://console.managed.compartment.test:18443';
export const managedInstallBaseDomain: string = 'managed.compartment.test';
export const managedInstallBrokerUrl: string = 'http://managed-domain-broker:19000';
export const managedInstallCertificateAuthorityPath: string = resolve(repositoryRoot, '.compartment/pebble.root.pem');
export const managedInstallKubeContext: string = 'k3d-compartment-e2e';
export const managedInstallNamespace: string = 'compartment-managed-e2e';
export const managedInstallPublicIpv4: string = ['8', '8', '4', '4'].join('.');
export const managedInstallReleaseName: string = 'managed-e2e';
export const managedInstallValuesPath: string = '.compartment/platform-k3d-managed-e2e-values.yaml';

interface ManagedDomainAllocationObservation {
  readonly installationId: string;
  readonly publicIp: string;
  readonly requestedLabelSource: string;
}

export interface ManagedDomainBrokerObservation {
  readonly allocations: readonly ManagedDomainAllocationObservation[];
  readonly txtDeletes: readonly ManagedDomainTxtObservation[];
  readonly txtWrites: readonly ManagedDomainTxtObservation[];
}

interface ManagedDomainTxtObservation {
  readonly name: string;
  readonly value: string;
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

export async function readManagedInstallCertificateSubjectAltName(): Promise<string> {
  const ca: Buffer = await readFile(managedInstallCertificateAuthorityPath);
  return await new Promise<string>(
    (resolveSubjectAltName: (subjectAltName: string) => void, rejectSubjectAltName: (error: Error) => void): void => {
      const socket: TLSSocket = connect(
        {
          ca,
          host: '127.0.0.1',
          port: 18_443,
          rejectUnauthorized: true,
          servername: `console.${managedInstallBaseDomain}`,
        },
        (): void => {
          const certificate: X509Certificate | undefined = socket.getPeerX509Certificate();
          socket.end();
          if (certificate === undefined) {
            rejectSubjectAltName(new Error('Managed HTTPS endpoint did not provide a peer certificate.'));
            return;
          }
          const subjectAltName: string | undefined = certificate.subjectAltName;
          if (subjectAltName === undefined) {
            rejectSubjectAltName(new Error('Managed HTTPS certificate did not contain subject alternative names.'));
            return;
          }
          resolveSubjectAltName(subjectAltName);
        },
      );
      socket.once('error', rejectSubjectAltName);
    },
  );
}

async function writeManagedInstallCertificateAuthority(): Promise<void> {
  const managementCa: Buffer = await readFile(resolve(repositoryRoot, '.compartment/pebble.minica.pem'));
  const rootCertificate: Buffer = await new Promise<Buffer>(
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
      request.once('error', rejectCertificate);
    },
  );
  const certificate: X509Certificate = new X509Certificate(rootCertificate);
  if (certificate.ca !== true || certificate.checkIssued(certificate) !== true) {
    throw new Error('Pebble root endpoint did not return a self-issued CA certificate.');
  }
  await writeFile(managedInstallCertificateAuthorityPath, rootCertificate, { mode: 0o600 });
}

export async function waitForManagedDomainBrokerObservation(): Promise<ManagedDomainBrokerObservation> {
  const deadline: number = Date.now() + brokerStateTimeoutMs;
  for (;;) {
    const response: Response = await fetch(`${managedInstallBrokerUrl}/__test/state`);
    if (response.ok) {
      const observation: ManagedDomainBrokerObservation = (await response.json()) as ManagedDomainBrokerObservation;
      if (
        observation.allocations.length === 1 &&
        observation.txtWrites.length > 0 &&
        observation.txtDeletes.length > 0
      ) {
        return observation;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for managed-domain allocation and DNS-01 cleanup.');
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
