import type { CommandResult } from '../src/command-runner.types';
import type { JsonValue } from '@compartment/utils';
import type { KubernetesInstallProgressReporter } from '../src/services/kubernetes-install-progress.types';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallRegistryValues,
  KubernetesInstallSecretValues,
  KubernetesInstallState,
  KubernetesIngressEndpoint,
} from '../src/services/kubernetes-install.service.types';
import type { Mock } from 'vitest';

export interface ImageTrustWriteInput {
  outputPath: string;
}

interface InstallValuesWithStorage extends KubernetesInstallSecretValues {
  storage: { storageClass: string };
}

export interface KubernetesInstallServiceMocks {
  assertRegistryDns: Mock<
    (input: KubernetesInstallDeploymentInput, state: KubernetesInstallState) => Promise<string | null>
  >;
  readChartValues: Mock<(chartPath: string) => Promise<JsonValue>>;
  runCommand: Mock<RunCommand>;
  usesOperatorTlsSecret: Mock<(valuesPath: string) => Promise<boolean>>;
  verifyRegistryNodePull: Mock<
    (input: KubernetesInstallDeploymentInput, state: KubernetesInstallState) => Promise<void>
  >;
  writeVerifiedImages: Mock<(input: ImageTrustWriteInput) => Promise<void>>;
}

export interface InstallHarnessState {
  events: string[];
  installValueModes: number[];
  installValuePaths: string[];
  installValues: KubernetesInstallSecretValues[];
  releaseValues: string | null;
  retainedSecretOutput: string | null;
  retainedState: KubernetesInstallState | null;
}

export type RunCommandCall = [command: readonly string[]];
type RunCommand = (command: readonly string[]) => Promise<CommandResult>;

export function ingressAddressList(addresses: readonly string[]): string {
  return JSON.stringify({
    items: [
      {
        status: { loadBalancer: { ingress: addresses.map((ip: string): { ip: string } => ({ ip })) } },
      },
    ],
  });
}

function encodeSecretValue(value: string): string {
  return Buffer.from(value).toString('base64');
}

export function retainedInstallStateSecretList(
  state: KubernetesInstallState | null,
  includeRegistry: boolean = true,
): string {
  if (state === null) {
    return JSON.stringify({ items: [] });
  }
  return JSON.stringify({
    items: [
      {
        data: {
          'acme-email': encodeSecretValue(state.acmeEmail),
          'base-domain': encodeSecretValue(state.baseDomain),
          'domain-mode': encodeSecretValue(state.domainMode),
          'installation-id': encodeSecretValue(state.installationId),
          'ingress-class-name': encodeSecretValue(state.ingressClassName),
          'ingress-endpoint-type': encodeSecretValue(state.ingressEndpoint?.type ?? ''),
          'ingress-endpoint-value': encodeSecretValue(state.ingressEndpoint?.value ?? ''),
          'ingress-targets-json': encodeSecretValue(JSON.stringify(state.ingressTargets)),
          'managed-domain-acme-dns-token': encodeSecretValue(state.managedDomainAcmeDnsToken),
          'managed-domain-broker-url': encodeSecretValue(state.brokerUrl),
          'public-protocol': encodeSecretValue(state.publicProtocol),
          ...(includeRegistry
            ? {
                'registry-hostname': encodeSecretValue(state.registryHostname),
                'registry-issuer-ref-kind': encodeSecretValue(state.registryIssuerRef.kind),
                'registry-issuer-ref-name': encodeSecretValue(state.registryIssuerRef.name),
              }
            : {}),
          'tls-mode': encodeSecretValue(state.tlsMode),
        },
      },
    ],
  });
}

export function deployedReleaseList(): string {
  return helmReleaseList('deployed');
}

export function existingInstallValues(stage: 'foundation' | 'full', domainMode: 'custom' | 'managed'): string {
  const baseDomain: string = domainMode === 'managed' ? 'acme.compartment.run' : 'apps.example.com';
  const publicIpv4: string = [8, 8, 8, 8].join('.');
  return JSON.stringify({
    ingress: {
      className: 'traefik',
      endpoint: { type: 'A', value: publicIpv4 },
      targetsJson: JSON.stringify([{ type: 'A', value: publicIpv4 }]),
    },
    platform: {
      acmeEmail: 'admin@example.com',
      baseDomain,
      domainGeneration: stage === 'full' ? 1 : 0,
      domainMode,
      installationId: 'installation-123',
      managedDomainBrokerUrl: domainMode === 'managed' ? 'https://broker.compartment.run' : '',
      publicProtocol: 'https',
      startupStage: stage,
      tlsMode: domainMode === 'managed' ? 'broker-dns01' : 'issuer',
    },
    registry: {
      hostname: `registry.${baseDomain}`,
      issuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
    },
    secrets: {
      installToken: 'existing-install-token',
      managedDomainAcmeDnsToken: domainMode === 'managed' ? 'acme-dns-token' : '',
    },
  });
}

export function existingInstallValuesWithStorage(
  stage: 'foundation' | 'full',
  domainMode: 'custom' | 'managed',
  storageClass: string,
  ingressEndpoint?: KubernetesIngressEndpoint,
): string {
  const values: InstallValuesWithStorage = JSON.parse(
    existingInstallValues(stage, domainMode),
  ) as InstallValuesWithStorage;
  values.storage = { storageClass };
  if (ingressEndpoint !== undefined && values.ingress !== undefined) {
    values.ingress.endpoint = ingressEndpoint;
    values.ingress.targetsJson = JSON.stringify([ingressEndpoint]);
  }
  return JSON.stringify(values);
}

export function existingLocalhostInstallValues(): string {
  return JSON.stringify({
    ingress: { className: 'traefik', endpoint: { type: '', value: '' }, targetsJson: '[]' },
    platform: {
      acmeEmail: 'admin@example.com',
      baseDomain: 'compartment.localhost',
      domainGeneration: 1,
      domainMode: 'custom',
      installationId: 'installation-localhost',
      managedDomainBrokerUrl: '',
      publicProtocol: 'http',
      startupStage: 'full',
      tlsMode: 'issuer',
    },
    registry: {
      hostname: 'registry.compartment.localhost',
      issuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
    },
    secrets: { installToken: 'existing-install-token', managedDomainAcmeDnsToken: '' },
  });
}

export function legacyOperatorFoundationValues(): string {
  const values: KubernetesInstallSecretValues & { registry?: KubernetesInstallRegistryValues } = JSON.parse(
    existingInstallValues('foundation', 'custom'),
  ) as KubernetesInstallSecretValues;
  Reflect.deleteProperty(values, 'registry');
  return JSON.stringify(values);
}

export function managedInstallValuesWithoutIngress(): string {
  const values: KubernetesInstallSecretValues = JSON.parse(
    existingInstallValues('foundation', 'managed'),
  ) as KubernetesInstallSecretValues;
  values.ingress = { className: 'traefik', endpoint: { type: '', value: '' }, targetsJson: '[]' };
  return JSON.stringify(values);
}

export function helmReleaseList(status: string): string {
  return JSON.stringify([{ name: 'compartment', revision: '4', status }]);
}

export function readyControlPlaneResponse(): Response {
  return new Response(null, { headers: { location: '/login' }, status: 302 });
}

export function successfulCommandResult(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

export function createFetchConnectionError(code: string): Error {
  const error: Error = new TypeError('fetch failed');
  (error as Error & { cause?: { code?: string | undefined } | undefined }).cause = { code };
  return error;
}

export class RecordingProgressReporter implements KubernetesInstallProgressReporter {
  public constructor(private readonly events: string[]) {}
  public report(message: string): void {
    this.events.push(message);
  }
}
