import type { CommandResult } from '../src/command-runner.types';
import type { KubernetesInstallProgressReporter } from '../src/services/kubernetes-install-progress.types';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallSecretValues,
  KubernetesInstallState,
} from '../src/services/kubernetes-install.service.types';
import type { Mock } from 'vitest';

export interface ImageTrustWriteInput {
  outputPath: string;
}

export interface KubernetesInstallServiceMocks {
  assertRegistryDns: Mock<(input: KubernetesInstallDeploymentInput, state: KubernetesInstallState) => Promise<void>>;
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
          'managed-domain-allocation-id': encodeSecretValue(state.managedDomainAllocationId),
          'managed-domain-broker-token': encodeSecretValue(state.managedDomainBrokerToken),
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

export function helmReleaseList(status: string): string {
  return JSON.stringify([{ name: 'compartment', status }]);
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
