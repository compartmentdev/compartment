import type { JsonValue } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type {
  ExistingKubernetesInstall,
  HelmReleaseSummary,
  KubernetesInstallDeploymentInput,
} from './kubernetes-install.service.types';

type HelmJsonObject = Record<string, JsonValue>;

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
    '--all',
    '--namespace',
    input.namespace,
    '--filter',
    `^${escapeRegularExpression(input.releaseName)}$`,
    '--output',
    'json',
    ...buildKubeContextArgs(input),
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
    ...buildKubeContextArgs(input),
  ];
}

function buildKubeContextArgs(input: KubernetesInstallDeploymentInput): string[] {
  return input.kubeContext === undefined ? [] : ['--kube-context', input.kubeContext];
}

async function runHelmInspection(command: readonly string[], operation: string): Promise<CommandResult> {
  const result: CommandResult = await runCommand(command);
  if (result.exitCode === 0) {
    return result;
  }
  const output: string = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
  throw new Error(
    `Helm ${operation} failed with exit code ${result.exitCode.toString()}.${output === '' ? '' : `\n${output}`}`,
  );
}

function readNamedHelmRelease(output: string, releaseName: string): HelmReleaseSummary | null {
  const value: JsonValue = parseHelmJson(output, 'release lookup');
  if (!Array.isArray(value)) {
    throw new Error('Helm release lookup returned an unexpected response.');
  }
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
  const value: JsonValue = parseHelmJson(output, 'release values lookup');
  if (!isHelmJsonObject(value)) {
    throw new Error('Helm release values lookup returned an unexpected response.');
  }
  const platform: JsonValue | undefined = value.platform;
  const secrets: JsonValue | undefined = value.secrets;
  return {
    baseDomain: readExistingBaseDomain(platform),
    installToken: readExistingInstallToken(secrets),
    stage: readExistingInstallStage(platform),
  };
}

function readExistingBaseDomain(platform: JsonValue | undefined): string {
  const baseDomain: JsonValue | undefined = isHelmJsonObject(platform) ? platform.baseDomain : undefined;
  if (typeof baseDomain === 'string' && baseDomain.trim() !== '') {
    return baseDomain.trim().toLowerCase();
  }
  throw new Error('The existing Helm release has no recognized platform.baseDomain.');
}

function readExistingInstallStage(platform: JsonValue | undefined): 'foundation' | 'full' {
  const stage: JsonValue | undefined = isHelmJsonObject(platform) ? platform.startupStage : undefined;
  if (stage === 'foundation' || stage === 'full') {
    return stage;
  }
  throw new Error('The existing Helm release has no recognized platform.startupStage.');
}

function readExistingInstallToken(secrets: JsonValue | undefined): string | null {
  const installToken: JsonValue | undefined = isHelmJsonObject(secrets) ? secrets.installToken : undefined;
  return typeof installToken === 'string' && installToken.trim() !== '' ? installToken : null;
}

function isHelmJsonObject(value: JsonValue | undefined): value is HelmJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHelmJson(output: string, operation: string): JsonValue {
  try {
    return JSON.parse(output) as JsonValue;
  } catch {
    throw new Error(`Helm ${operation} returned invalid JSON.`);
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
