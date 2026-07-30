import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type {
  KubectlVersionOutput,
  KubernetesInstallLocalToolRequirement,
  SemanticVersion,
} from './kubernetes-install-local-tools.service.types';

const helmInstallInstruction: string =
  'Install Helm >= 4.0.0 with `curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4 | bash`, then re-run install. See https://helm.sh/docs/intro/install/.';
const kubectlInstallInstruction: string =
  'Install kubectl >= 1.30.0, then re-run install. See https://kubernetes.io/docs/tasks/tools/#kubectl.';

const kubernetesInstallLocalTools: readonly KubernetesInstallLocalToolRequirement[] = [
  {
    binary: 'helm',
    installInstruction: helmInstallInstruction,
    minimumVersion: '4.0.0',
    versionCommand: ['helm', 'version', '--template', '{{.Version}}'],
  },
  {
    binary: 'kubectl',
    installInstruction: kubectlInstallInstruction,
    minimumVersion: '1.30.0',
    versionCommand: ['kubectl', 'version', '--client', '--output=json'],
  },
];

export async function assertKubernetesInstallLocalTools(): Promise<void> {
  for (const requirement of kubernetesInstallLocalTools) {
    await assertLocalTool(requirement);
  }
}

async function assertLocalTool(requirement: KubernetesInstallLocalToolRequirement): Promise<void> {
  const result: CommandResult = await runCommand(requirement.versionCommand);
  if (result.failure?.kind === 'command-not-found') {
    throw new Error(formatMissingKubernetesInstallTool(requirement.binary));
  }
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read ${requirement.binary} version. ${requirement.installInstruction}`);
  }

  const foundVersion: string = readToolVersion(requirement, result.stdout);
  if (
    compareSemanticVersions(parseSemanticVersion(foundVersion), parseSemanticVersion(requirement.minimumVersion)) < 0
  ) {
    throw new Error(
      `${requirement.binary} ${foundVersion} is installed, but ${requirement.binary} >= ${requirement.minimumVersion} is required. ${requirement.installInstruction}`,
    );
  }
}

export function formatMissingKubernetesInstallTool(binary: string): string {
  const requirement: KubernetesInstallLocalToolRequirement | undefined = kubernetesInstallLocalTools.find(
    (candidate: KubernetesInstallLocalToolRequirement): boolean => candidate.binary === binary,
  );
  return requirement === undefined
    ? `${binary} not found on PATH. Install ${binary} and re-run install.`
    : `${binary} not found on PATH. ${requirement.installInstruction}`;
}

function readToolVersion(requirement: KubernetesInstallLocalToolRequirement, output: string): string {
  if (requirement.binary === 'helm') {
    return readSemanticVersion(output, 'helm');
  }
  try {
    const parsed: KubectlVersionOutput = JSON.parse(output) as KubectlVersionOutput;
    return readSemanticVersion(parsed.clientVersion?.gitVersion ?? '', 'kubectl');
  } catch {
    throw new Error(`kubectl returned an invalid version response. ${requirement.installInstruction}`);
  }
}

function readSemanticVersion(value: string, binary: string): string {
  const displayVersion: string = value.trim();
  const match: RegExpExecArray | null = executeSemanticVersionPattern(displayVersion);
  if (match === null) {
    const requirement: KubernetesInstallLocalToolRequirement | undefined = kubernetesInstallLocalTools.find(
      (candidate: KubernetesInstallLocalToolRequirement): boolean => candidate.binary === binary,
    );
    throw new Error(
      `${binary} returned an unsupported version "${displayVersion}".${requirement === undefined ? '' : ` ${requirement.installInstruction}`}`,
    );
  }
  return displayVersion;
}

function parseSemanticVersion(value: string): SemanticVersion {
  const match: RegExpExecArray | null = executeSemanticVersionPattern(value);
  if (match === null) {
    throw new Error(`Expected a semantic version, received "${value}".`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] === undefined ? {} : { prerelease: match[4] }),
  };
}

function executeSemanticVersionPattern(value: string): RegExpExecArray | null {
  return /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
    value,
  );
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  const majorDifference: number = left.major - right.major;
  if (majorDifference !== 0) {
    return majorDifference;
  }
  const minorDifference: number = left.minor - right.minor;
  if (minorDifference !== 0) {
    return minorDifference;
  }
  const patchDifference: number = left.patch - right.patch;
  if (patchDifference !== 0) {
    return patchDifference;
  }
  if (left.prerelease === undefined) {
    return right.prerelease === undefined ? 0 : 1;
  }
  return right.prerelease === undefined ? -1 : left.prerelease.localeCompare(right.prerelease);
}
