import { parseJsonWith, type JsonValue } from '@compartment/utils';
import { z } from 'zod';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import {
  buildHelmCommand,
  buildHelmGetValuesCommand,
  formatKubernetesCommandExecutionFailure,
  readCommandDiagnostics,
} from './kubernetes-command.support';
import { parseKubernetesIngressTargetsJson } from './kubernetes-install-ingress-targets.service';
import type { KubernetesInstallRegistryIssuerReference } from './kubernetes-install-registry.service.types';
import type {
  ExistingKubernetesInstall,
  HelmReleaseSummary,
  KubernetesInstallDeploymentInput,
  KubernetesInstallDomainMode,
  KubernetesIngressEndpoint,
  KubernetesInstallTlsMode,
  KubernetesPublicProtocol,
} from './kubernetes-install.service.types';

type HelmJsonObject = Record<string, JsonValue>;
const helmJsonObjectSchema: z.ZodType<HelmJsonObject> = z.record(z.custom<JsonValue>());
const helmReleaseListSchema: z.ZodType<JsonValue[]> = z.array(z.custom<JsonValue>());
const kubernetesInspectionTimeoutMs: number = 30_000;

export async function readExistingKubernetesInstall(
  input: KubernetesInstallDeploymentInput,
): Promise<ExistingKubernetesInstall | null> {
  const listResult: CommandResult = await runHelmInspection(buildHelmReleaseListCommand(input), 'release lookup', true);
  const release: HelmReleaseSummary | null = readNamedHelmRelease(listResult.stdout, input.releaseName);
  if (release === null) {
    return null;
  }
  requireDeployedHelmRelease(release);

  const valuesResult: CommandResult = await runHelmInspection(
    buildHelmReleaseValuesCommand(input),
    'release values lookup',
    false,
  );
  return parseExistingKubernetesInstall(valuesResult.stdout);
}

function buildHelmReleaseListCommand(input: KubernetesInstallDeploymentInput): string[] {
  return buildHelmCommand(input, [
    'list',
    '--namespace',
    input.namespace,
    '--filter',
    `^${escapeRegularExpression(input.releaseName)}$`,
    '--output',
    'json',
  ]);
}

function buildHelmReleaseValuesCommand(input: KubernetesInstallDeploymentInput): string[] {
  return buildHelmGetValuesCommand(input, input.releaseName, ['--all', '--output', 'json']);
}

async function runHelmInspection(
  command: readonly string[],
  operation: string,
  includeStdoutInDiagnostics: boolean,
): Promise<CommandResult> {
  const result: CommandResult = await runCommandWithTimeout(command, kubernetesInspectionTimeoutMs);
  if (result.exitCode === 0) {
    return result;
  }
  const executionFailure: string | undefined = formatKubernetesCommandExecutionFailure(
    `Helm ${operation} failed`,
    result,
  );
  if (executionFailure !== undefined) {
    throw new Error(executionFailure);
  }
  const output: string = readCommandDiagnostics(result, { includeStdout: includeStdoutInDiagnostics });
  if (result.exitCode === 124) {
    throw buildHelmInspectionTimeoutError(operation, output);
  }
  throw new Error(
    `Helm ${operation} failed with exit code ${result.exitCode.toString()}.${output === '' ? '' : `\n${output}`}`,
  );
}

function buildHelmInspectionTimeoutError(operation: string, output: string): Error {
  return new Error(
    `Timed out after 30s during Helm ${operation}. Check that the Kubernetes API is reachable for the selected context, then re-run install to resume.${output === '' ? '' : `\n${output}`}`,
  );
}

function readNamedHelmRelease(output: string, releaseName: string): HelmReleaseSummary | null {
  const value: JsonValue[] = parseJsonWith(helmReleaseListSchema, output);
  const candidate: JsonValue | undefined = value.find(
    (releaseCandidate: JsonValue): boolean =>
      isHelmJsonObject(releaseCandidate) && releaseCandidate.name === releaseName,
  );
  if (candidate === undefined || !isHelmJsonObject(candidate) || typeof candidate.status !== 'string') {
    return candidate === undefined ? null : invalidHelmReleaseLookup();
  }
  return { name: releaseName, status: candidate.status };
}

function invalidHelmReleaseLookup(): never {
  throw new Error('Helm release lookup returned a release without a status.');
}

function requireDeployedHelmRelease(release: HelmReleaseSummary): void {
  if (release.status === 'deployed') {
    return;
  }
  throw new Error(
    `The existing Helm release ${release.name} has status ${release.status}. Resolve or uninstall that release before retrying compartment install.`,
  );
}

function parseExistingKubernetesInstall(output: string): ExistingKubernetesInstall {
  const value: HelmJsonObject = parseJsonWith(helmJsonObjectSchema, output);
  const platform: JsonValue | undefined = value.platform;
  const registry: JsonValue | undefined = value.registry;
  const ingress: JsonValue | undefined = value.ingress;
  const secrets: JsonValue | undefined = value.secrets;
  return {
    acmeEmail: readOptionalPlatformText(platform, 'acmeEmail'),
    baseDomain: readOptionalPlatformText(platform, 'baseDomain').toLowerCase(),
    brokerUrl: readOptionalPlatformText(platform, 'managedDomainBrokerUrl'),
    domainMode: readExistingDomainMode(platform),
    installToken: readExistingInstallToken(secrets),
    installationId: readOptionalPlatformText(platform, 'installationId'),
    ingressClassName: readRequiredText(ingress, 'className', 'ingress.className'),
    ingressEndpoint: readIngressEndpoint(ingress),
    ingressTargets: readIngressTargets(ingress),
    managedDomainAllocationId: readOptionalPlatformText(platform, 'managedDomainAllocationId'),
    managedDomainBrokerToken: readOptionalSecretText(secrets, 'managedDomainBrokerToken'),
    publicProtocol: readExistingPublicProtocol(platform),
    registryHostname: readOptionalText(registry, 'hostname').toLowerCase(),
    registryIssuerRef: readExistingRegistryIssuerRef(registry),
    stage: readExistingInstallStage(platform),
    tlsMode: readExistingTlsMode(platform),
  };
}

function readExistingRegistryIssuerRef(registry: JsonValue | undefined): KubernetesInstallRegistryIssuerReference {
  const issuerRef: JsonValue | undefined = isHelmJsonObject(registry) ? registry.issuerRef : undefined;
  const kind: JsonValue | undefined = isHelmJsonObject(issuerRef) ? issuerRef.kind : undefined;
  const name: JsonValue | undefined = isHelmJsonObject(issuerRef) ? issuerRef.name : undefined;
  if ((kind === 'Issuer' || kind === 'ClusterIssuer') && typeof name === 'string' && name.trim() !== '') {
    return { group: 'cert-manager.io', kind, name: name.trim() };
  }
  return { group: 'cert-manager.io', kind: 'Issuer', name: '' };
}

function readOptionalText(section: JsonValue | undefined, fieldName: string): string {
  const value: JsonValue | undefined = isHelmJsonObject(section) ? section[fieldName] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function readIngressTargets(ingress: JsonValue | undefined): KubernetesIngressEndpoint[] {
  const targetsJson: JsonValue | undefined = isHelmJsonObject(ingress) ? ingress.targetsJson : undefined;
  if (typeof targetsJson !== 'string' || targetsJson === '') {
    const endpoint: KubernetesIngressEndpoint | null = readIngressEndpoint(ingress);
    return endpoint === null ? [] : [endpoint];
  }
  return parseKubernetesIngressTargetsJson(targetsJson, 'The existing Helm release');
}

function readIngressEndpoint(ingress: JsonValue | undefined): KubernetesIngressEndpoint | null {
  const endpoint: JsonValue | undefined = isHelmJsonObject(ingress) ? ingress.endpoint : undefined;
  const type: JsonValue | undefined = isHelmJsonObject(endpoint) ? endpoint.type : undefined;
  const value: JsonValue | undefined = isHelmJsonObject(endpoint) ? endpoint.value : undefined;
  if ((type === undefined || type === '') && (value === undefined || value === '')) {
    return null;
  }
  if ((type === 'A' || type === 'AAAA' || type === 'hostname') && typeof value === 'string' && value !== '') {
    return { type, value };
  }
  throw new Error('The existing Helm release has no recognized ingress.endpoint.');
}

function readRequiredText(section: JsonValue | undefined, fieldName: string, qualifiedName: string): string {
  const value: JsonValue | undefined = isHelmJsonObject(section) ? section[fieldName] : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  throw new Error(`The existing Helm release has no ${qualifiedName}.`);
}

function readExistingDomainMode(platform: JsonValue | undefined): KubernetesInstallDomainMode {
  const domainMode: JsonValue | undefined = isHelmJsonObject(platform) ? platform.domainMode : undefined;
  if (domainMode === 'custom' || domainMode === 'managed') {
    return domainMode;
  }
  if (domainMode === undefined) {
    return 'custom';
  }
  throw new Error('The existing Helm release has no recognized platform.domainMode.');
}

function readExistingInstallStage(platform: JsonValue | undefined): 'foundation' | 'full' {
  const stage: JsonValue | undefined = isHelmJsonObject(platform) ? platform.startupStage : undefined;
  if (stage === 'foundation' || stage === 'full') {
    return stage;
  }
  throw new Error('The existing Helm release has no recognized platform.startupStage.');
}

function readExistingPublicProtocol(platform: JsonValue | undefined): KubernetesPublicProtocol {
  const protocol: JsonValue | undefined = isHelmJsonObject(platform) ? platform.publicProtocol : undefined;
  if (protocol === 'http' || protocol === 'https') {
    return protocol;
  }
  throw new Error('The existing Helm release has no recognized platform.publicProtocol.');
}

function readExistingTlsMode(platform: JsonValue | undefined): KubernetesInstallTlsMode {
  const tlsMode: JsonValue | undefined = isHelmJsonObject(platform) ? platform.tlsMode : undefined;
  if (tlsMode === 'broker-dns01' || tlsMode === 'issuer' || tlsMode === 'internal') {
    return tlsMode;
  }
  throw new Error('The existing Helm release has no recognized platform.tlsMode.');
}

function readExistingInstallToken(secrets: JsonValue | undefined): string | null {
  const installToken: JsonValue | undefined = isHelmJsonObject(secrets) ? secrets.installToken : undefined;
  return typeof installToken === 'string' && installToken.trim() !== '' ? installToken : null;
}

function readOptionalPlatformText(platform: JsonValue | undefined, fieldName: string): string {
  const value: JsonValue | undefined = isHelmJsonObject(platform) ? platform[fieldName] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalSecretText(secrets: JsonValue | undefined, fieldName: string): string {
  const value: JsonValue | undefined = isHelmJsonObject(secrets) ? secrets[fieldName] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function isHelmJsonObject(value: JsonValue | undefined): value is HelmJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
