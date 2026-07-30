import type { DomainIssuerReference } from '@compartment/contracts';
import { parseJsonWith } from '@compartment/utils';
import { z } from 'zod';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure, readCommandOutput } from './kubernetes-command.support';
import { parseKubernetesIngressTargetsJson } from './kubernetes-install-ingress-targets.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDomainMode,
  KubernetesInstallTlsMode,
  KubernetesIngressEndpoint,
  KubernetesPublicProtocol,
  KubernetesSecretList,
  KubernetesSecretListItem,
  RetainedKubernetesInstallState,
  RetainedManagedDomainState,
  ExistingKubernetesInstall,
} from './kubernetes-install.service.types';

const installStateComponentLabel: string = 'install-state';
const kubernetesSecretListSchema: z.ZodType<KubernetesSecretList> = z
  .object({
    items: z.array(z.custom<KubernetesSecretListItem>()),
  })
  .passthrough();
const kubernetesInspectionTimeoutMs: number = 30_000;
const domainIssuerReferenceSchema: z.ZodType<DomainIssuerReference> = z
  .object({
    kind: z.enum(['Issuer', 'ClusterIssuer']),
    name: z.string().min(1),
  })
  .strict();

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
  input: Pick<KubernetesInstallDeploymentInput, 'kubeconfigPath' | 'kubeContext' | 'namespace' | 'releaseName'>,
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
  assertCompleteRetainedManagedDomain(state);
  return state;
}

function assertCompleteRetainedManagedDomain(state: RetainedManagedDomainState): void {
  if ([state.allocationId, state.baseDomain, state.brokerUrl, state.brokerToken, state.acmeEmail].includes('')) {
    throw new Error('This installation has no retained managed domain to restore.');
  }
}

function buildRetainedManagedDomainState(data: Record<string, string>): RetainedManagedDomainState {
  return {
    acmeEmail: readSecretText(data, 'acme-email'),
    allocationId: readSecretText(data, 'managed-domain-allocation-id'),
    baseDomain: readSecretText(data, 'managed-base-domain').toLowerCase(),
    brokerToken: readSecretText(data, 'managed-domain-broker-token'),
    brokerUrl: readSecretText(data, 'managed-domain-broker-url'),
    issuerRef: parseJsonWith(domainIssuerReferenceSchema, readRequiredSecretText(data, 'managed-issuer-ref-json')),
    publicProtocol: 'https',
    tlsMode: 'broker-dns01',
  };
}

function createRetainedStateInspectionError(result: CommandResult): Error {
  const output: string = readCommandOutput(result);
  return result.exitCode === 124
    ? new Error(
        `Timed out after 30s inspecting retained Kubernetes install state. Check that the Kubernetes API is reachable for the selected context, then re-run install to resume.${output === '' ? '' : `\n${output}`}`,
      )
    : new Error(formatKubernetesCommandFailure('Failed to inspect retained Kubernetes install state', result));
}
export function mergeRetainedKubernetesInstallState(
  existingInstall: ExistingKubernetesInstall | null,
  retainedState: RetainedKubernetesInstallState | null,
): ExistingKubernetesInstall | null {
  if (existingInstall === null || retainedState === null) {
    return existingInstall;
  }
  const merged: ExistingKubernetesInstall = {
    ...retainedState,
    installToken: existingInstall.installToken,
    stage: existingInstall.stage,
  };
  mergeRetainedIdentityFields(merged, existingInstall);
  mergeRetainedIngressFields(merged, existingInstall);
  mergeRetainedBrokerFields(merged, existingInstall);
  return merged;
}

function mergeRetainedIdentityFields(merged: ExistingKubernetesInstall, current: ExistingKubernetesInstall): void {
  merged.acmeEmail = preferRetainedText(merged.acmeEmail, current.acmeEmail);
  merged.baseDomain = preferRetainedText(merged.baseDomain, current.baseDomain);
}

function mergeRetainedIngressFields(merged: ExistingKubernetesInstall, current: ExistingKubernetesInstall): void {
  merged.ingressClassName = preferRetainedText(merged.ingressClassName, current.ingressClassName);
  merged.ingressEndpoint ??= current.ingressEndpoint;
  merged.ingressTargets = merged.ingressTargets.length > 0 ? merged.ingressTargets : current.ingressTargets;
}

function mergeRetainedBrokerFields(merged: ExistingKubernetesInstall, current: ExistingKubernetesInstall): void {
  merged.brokerUrl = preferRetainedText(merged.brokerUrl, current.brokerUrl);
  merged.managedDomainAllocationId = preferRetainedText(
    merged.managedDomainAllocationId,
    current.managedDomainAllocationId,
  );
  merged.managedDomainBrokerToken = preferRetainedText(
    merged.managedDomainBrokerToken,
    current.managedDomainBrokerToken,
  );
  merged.registryHostname = preferRetainedText(merged.registryHostname, current.registryHostname);
  if (merged.registryIssuerRef.name === '') {
    merged.registryIssuerRef = current.registryIssuerRef;
  }
}

function preferRetainedText(retainedValue: string, currentValue: string): string {
  return retainedValue !== '' ? retainedValue : currentValue;
}

function isMissingNamespaceFailure(result: CommandResult, namespace: string): boolean {
  const failure: string = readCommandOutput(result);
  return failure.includes('(NotFound)') && failure.includes(`namespaces "${namespace}" not found`);
}

function buildRetainedStateSecretCommand(
  input: Pick<KubernetesInstallDeploymentInput, 'kubeconfigPath' | 'kubeContext' | 'namespace' | 'releaseName'>,
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
  const value: KubernetesSecretList = parseJsonWith(kubernetesSecretListSchema, output);
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
    ingressClassName: readRequiredSecretText(data, 'ingress-class-name'),
    ingressEndpoint: readIngressEndpoint(data),
    ingressTargets: readIngressTargets(data),
    managedDomainAllocationId: readSecretText(data, 'managed-domain-allocation-id'),
    managedDomainBrokerToken: readSecretText(data, 'managed-domain-broker-token'),
    publicProtocol: readPublicProtocol(data),
    registryHostname: readSecretText(data, 'registry-hostname').toLowerCase(),
    registryIssuerRef: {
      group: 'cert-manager.io',
      kind: readRegistryIssuerKind(data),
      name: readSecretText(data, 'registry-issuer-ref-name'),
    },
    tlsMode: readTlsMode(data),
  };
}

function readRegistryIssuerKind(data: Record<string, string>): 'Issuer' | 'ClusterIssuer' {
  const value: string = readSecretText(data, 'registry-issuer-ref-kind');
  if (value === '') {
    return 'Issuer';
  }
  if (value === 'Issuer' || value === 'ClusterIssuer') {
    return value;
  }
  throw new Error('The retained install-state Secret has no recognized registry issuer kind.');
}

function readIngressTargets(data: Record<string, string>): KubernetesIngressEndpoint[] {
  const encoded: string = readSecretText(data, 'ingress-targets-json');
  if (encoded === '') {
    const endpoint: KubernetesIngressEndpoint | null = readIngressEndpoint(data);
    return endpoint === null ? [] : [endpoint];
  }
  return parseKubernetesIngressTargetsJson(encoded, 'The retained install-state Secret');
}

function readIngressEndpoint(data: Record<string, string>): KubernetesIngressEndpoint | null {
  const type: string = readSecretText(data, 'ingress-endpoint-type');
  const value: string = readSecretText(data, 'ingress-endpoint-value');
  if (type === '' && value === '') {
    return null;
  }
  if ((type === 'A' || type === 'AAAA' || type === 'hostname') && value !== '') {
    return { type, value };
  }
  throw new Error('The retained install-state Secret has no recognized ingress endpoint.');
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
  if (value === 'broker-dns01' || value === 'internal' || value === 'issuer') {
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
  return Buffer.from(data[key] ?? '', 'base64')
    .toString('utf8')
    .trim();
}
