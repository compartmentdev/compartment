import { parseJsonWith, type JsonValue } from '@compartment/utils';
import { z } from 'zod';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildHelmKubeContextArgs, readCommandOutput } from './kubernetes-command.support';
import type {
  ExistingKubernetesInstall,
  HelmReleaseSummary,
  KubernetesInstallDeploymentInput,
  KubernetesInstallDomainMode,
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
  const listResult: CommandResult = await runHelmInspection(buildHelmReleaseListCommand(input), 'release lookup');
  const release: HelmReleaseSummary | null = readNamedHelmRelease(listResult.stdout, input.releaseName);
  if (release === null) {
    return null;
  }
  requireDeployedHelmRelease(release);

  const valuesResult: CommandResult = await runHelmInspection(
    buildHelmReleaseValuesCommand(input),
    'release values lookup',
  );
  return parseExistingKubernetesInstall(valuesResult.stdout);
}

function buildHelmReleaseListCommand(input: KubernetesInstallDeploymentInput): string[] {
  return [
    'helm',
    'list',
    '--namespace',
    input.namespace,
    '--filter',
    `^${escapeRegularExpression(input.releaseName)}$`,
    '--output',
    'json',
    ...buildHelmKubeContextArgs(input),
  ];
}

function buildHelmReleaseValuesCommand(input: KubernetesInstallDeploymentInput): string[] {
  return [
    'helm',
    'get',
    'values',
    input.releaseName,
    '--namespace',
    input.namespace,
    '--all',
    '--output',
    'json',
    ...buildHelmKubeContextArgs(input),
  ];
}

async function runHelmInspection(command: readonly string[], operation: string): Promise<CommandResult> {
  const result: CommandResult = await runCommandWithTimeout(command, kubernetesInspectionTimeoutMs);
  if (result.exitCode === 0) {
    return result;
  }
  const output: string = readCommandOutput(result);
  if (result.exitCode === 124) {
    throw new Error(
      `Timed out after 30s during Helm ${operation}. Check that the Kubernetes API is reachable for the selected context, then re-run install to resume.${output === '' ? '' : `\n${output}`}`,
    );
  }
  throw new Error(
    `Helm ${operation} failed with exit code ${result.exitCode.toString()}.${output === '' ? '' : `\n${output}`}`,
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
  const secrets: JsonValue | undefined = value.secrets;
  return {
    acmeEmail: readOptionalPlatformText(platform, 'acmeEmail'),
    baseDomain: readOptionalPlatformText(platform, 'baseDomain').toLowerCase(),
    brokerUrl: readOptionalPlatformText(platform, 'managedDomainBrokerUrl'),
    domainMode: readExistingDomainMode(platform),
    installToken: readExistingInstallToken(secrets),
    installationId: readOptionalPlatformText(platform, 'installationId'),
    managedDomainBrokerToken: readOptionalSecretText(secrets, 'managedDomainBrokerToken'),
    publicIngressIpv4: readOptionalPlatformText(platform, 'publicIngressIpv4'),
    publicIngressIpv6: readOptionalPlatformText(platform, 'publicIngressIpv6'),
    publicProtocol: readExistingPublicProtocol(platform),
    stage: readExistingInstallStage(platform),
    tlsMode: readExistingTlsMode(platform),
  };
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
  if (tlsMode === 'custom-cert' || tlsMode === 'custom-http' || tlsMode === 'internal' || tlsMode === 'managed') {
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
