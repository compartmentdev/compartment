import type { JsonValue } from '@compartment/utils';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, readCommandOutput } from './kubernetes-command.support';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDomainMode,
  KubernetesInstallTlsMode,
  KubernetesPublicProtocol,
  KubernetesSecretList,
  KubernetesSecretListItem,
  RetainedKubernetesInstallState,
  RetainedManagedDomainState,
  ExistingKubernetesInstall,
} from './kubernetes-install.service.types';

const installStateComponentLabel: string = 'install-state';
const kubernetesInspectionTimeoutMs: number = 30_000;

export async function readRetainedKubernetesInstallState(
  input: KubernetesInstallDeploymentInput,
): Promise<RetainedKubernetesInstallState | null> {
  const result: CommandResult = await runCommandWithTimeout(
    buildRetainedStateSecretCommand(input),
    kubernetesInspectionTimeoutMs,
  );
  if (result.exitCode !== 0) {
    if (isMissingNamespaceFailure(result, input.namespace)) {
      return null;
    }
    throw createRetainedStateInspectionError(result);
  }
  return parseRetainedStateSecretList(result.stdout);
}

export async function readRetainedManagedKubernetesDomainState(
  input: Pick<KubernetesInstallDeploymentInput, 'kubeContext' | 'namespace' | 'releaseName'>,
): Promise<RetainedManagedDomainState> {
  const result: CommandResult = await runCommandWithTimeout(
    buildRetainedStateSecretCommand(input),
    kubernetesInspectionTimeoutMs,
  );
  if (result.exitCode !== 0) {
    throw createRetainedStateInspectionError(result);
  }
  const data: Record<string, string> | null = parseRetainedStateSecretData(result.stdout);
  if (data === null) {
    throw new Error('Expected exactly one retained install-state Secret for the Helm release.');
  }
  const state: RetainedManagedDomainState = buildRetainedManagedDomainState(data);
  if (state.baseDomain === '' || state.brokerUrl === '' || state.brokerToken === '' || state.acmeEmail === '') {
    throw new Error('This installation has no retained managed domain to restore.');
  }
  return state;
}

function buildRetainedManagedDomainState(data: Record<string, string>): RetainedManagedDomainState {
  return {
    acmeEmail: readSecretText(data, 'acme-email'),
    baseDomain: readSecretText(data, 'managed-base-domain').toLowerCase(),
    brokerToken: readSecretText(data, 'managed-domain-broker-token'),
    brokerUrl: readSecretText(data, 'managed-domain-broker-url'),
    publicProtocol: 'https',
    tlsMode: 'managed',
  };
}

function createRetainedStateInspectionError(result: CommandResult): Error {
  const output: string = readCommandOutput(result);
  return result.exitCode === 124
    ? new Error(
        `Timed out after 30s inspecting retained Kubernetes install state. Check that the Kubernetes API is reachable for the selected context, then re-run install to resume.${output === '' ? '' : `\n${output}`}`,
      )
    : new Error(`Failed to inspect retained Kubernetes install state: ${output}`);
}

export function mergeRetainedKubernetesInstallState(
  existingInstall: ExistingKubernetesInstall | null,
  retainedState: RetainedKubernetesInstallState | null,
): ExistingKubernetesInstall | null {
  if (existingInstall === null || retainedState === null) {
    return existingInstall;
  }
  return {
    ...retainedState,
    acmeEmail: preferRetainedText(retainedState.acmeEmail, existingInstall.acmeEmail),
    baseDomain: preferRetainedText(retainedState.baseDomain, existingInstall.baseDomain),
    brokerUrl: preferRetainedText(retainedState.brokerUrl, existingInstall.brokerUrl),
    installToken: existingInstall.installToken,
    managedDomainBrokerToken: preferRetainedText(
      retainedState.managedDomainBrokerToken,
      existingInstall.managedDomainBrokerToken,
    ),
    publicIngressIpv4: preferRetainedText(retainedState.publicIngressIpv4, existingInstall.publicIngressIpv4),
    publicIngressIpv6: preferRetainedText(retainedState.publicIngressIpv6, existingInstall.publicIngressIpv6),
    stage: existingInstall.stage,
  };
}

function preferRetainedText(retainedValue: string, currentValue: string): string {
  return retainedValue !== '' ? retainedValue : currentValue;
}

function isMissingNamespaceFailure(result: CommandResult, namespace: string): boolean {
  const failure: string = readCommandOutput(result);
  return failure.includes('(NotFound)') && failure.includes(`namespaces "${namespace}" not found`);
}

function buildRetainedStateSecretCommand(
  input: Pick<KubernetesInstallDeploymentInput, 'kubeContext' | 'namespace' | 'releaseName'>,
): string[] {
  return buildKubectlCommand(input, [
    '--request-timeout=10s',
    'get',
    'secret',
    '--selector',
    `app.kubernetes.io/instance=${input.releaseName},app.kubernetes.io/component=${installStateComponentLabel}`,
    '--output',
    'json',
  ]);
}

function parseRetainedStateSecretList(output: string): RetainedKubernetesInstallState | null {
  const data: Record<string, string> | null = parseRetainedStateSecretData(output);
  return data === null ? null : parseRetainedStateSecret(data);
}

function parseRetainedStateSecretData(output: string): Record<string, string> | null {
  const value: JsonValue = parseJson(output);
  if (!isSecretList(value)) {
    throw new Error('kubectl returned an invalid retained install-state Secret response.');
  }
  if (value.items.length === 0) {
    return null;
  }
  const secret: KubernetesSecretListItem | undefined = value.items[0];
  if (value.items.length !== 1 || secret?.data === undefined) {
    throw new Error('Expected exactly one retained install-state Secret for the Helm release.');
  }
  return secret.data;
}

function parseRetainedStateSecret(data: Record<string, string>): RetainedKubernetesInstallState {
  return {
    acmeEmail: readSecretText(data, 'acme-email'),
    baseDomain: readSecretText(data, 'base-domain').toLowerCase(),
    brokerUrl: readSecretText(data, 'managed-domain-broker-url'),
    domainMode: readDomainMode(data),
    installationId: readRequiredSecretText(data, 'installation-id'),
    managedDomainBrokerToken: readSecretText(data, 'managed-domain-broker-token'),
    publicIngressIpv4: readSecretText(data, 'public-ingress-ipv4'),
    publicIngressIpv6: readSecretText(data, 'public-ingress-ipv6'),
    publicProtocol: readPublicProtocol(data),
    tlsMode: readTlsMode(data),
  };
}

function readDomainMode(data: Record<string, string>): KubernetesInstallDomainMode {
  const value: string = readSecretText(data, 'domain-mode');
  if (value === 'custom' || value === 'managed') {
    return value;
  }
  throw new Error('The retained install-state Secret has no recognized domain mode.');
}

function readPublicProtocol(data: Record<string, string>): KubernetesPublicProtocol {
  const value: string = readSecretText(data, 'public-protocol');
  if (value === 'http' || value === 'https') {
    return value;
  }
  throw new Error('The retained install-state Secret has no recognized public protocol.');
}

function readTlsMode(data: Record<string, string>): KubernetesInstallTlsMode {
  const value: string = readSecretText(data, 'tls-mode');
  if (value === 'custom-cert' || value === 'custom-http' || value === 'internal' || value === 'managed') {
    return value;
  }
  throw new Error('The retained install-state Secret has no recognized TLS mode.');
}

function readRequiredSecretText(data: Record<string, string>, key: string): string {
  const value: string = readSecretText(data, key);
  if (value !== '') {
    return value;
  }
  throw new Error(`The retained install-state Secret has no ${key}.`);
}

function readSecretText(data: Record<string, string>, key: string): string {
  const encodedValue: string | undefined = data[key];
  return encodedValue === undefined ? '' : Buffer.from(encodedValue, 'base64').toString('utf8').trim();
}

function parseJson(output: string): JsonValue {
  try {
    return JSON.parse(output) as JsonValue;
  } catch {
    throw new Error('kubectl returned invalid JSON for the retained install-state Secret.');
  }
}

function isSecretList(value: JsonValue): value is KubernetesSecretList & JsonValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Array.isArray(value.items);
}
