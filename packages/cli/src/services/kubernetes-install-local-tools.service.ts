import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type {
  KubernetesInstallLocalToolVersions,
  KubectlVersionOutput,
  KubernetesInstallLocalToolRequirement,
} from './kubernetes-install-local-tools.service.types';
import {
  isSemanticVersionAtLeast,
  kubernetesInstallCompatibility,
  parseSemanticVersion,
} from './kubernetes-install-compatibility.service';

const helmInstallInstruction: string = `Install Helm >= ${kubernetesInstallCompatibility.helmMinimumVersion} with \`curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4 | bash\`, then re-run the command. See https://helm.sh/docs/intro/install/.`;
const kubectlInstallInstruction: string = `Install kubectl >= ${kubernetesInstallCompatibility.kubectlMinimumVersion}, then re-run the command. See https://kubernetes.io/docs/tasks/tools/#kubectl.`;

const kubernetesInstallLocalTools: readonly KubernetesInstallLocalToolRequirement[] = [
  {
    binary: 'kubectl',
    installInstruction: kubectlInstallInstruction,
    minimumVersion: kubernetesInstallCompatibility.kubectlMinimumVersion,
    versionCommand: ['kubectl', 'version', '--client', '--output=json'],
  },
  {
    binary: 'helm',
    installInstruction: helmInstallInstruction,
    minimumVersion: kubernetesInstallCompatibility.helmMinimumVersion,
    versionCommand: ['helm', 'version', '--template', '{{.Version}}'],
  },
];

export async function assertKubernetesInstallLocalTools(): Promise<KubernetesInstallLocalToolVersions> {
  const kubectl: string = await assertLocalTool(kubernetesInstallLocalTools[0]!);
  const helm: string = await assertLocalTool(kubernetesInstallLocalTools[1]!);
  return { helm, kubectl };
}

async function assertLocalTool(requirement: KubernetesInstallLocalToolRequirement): Promise<string> {
  const result: CommandResult = await runCommand(requirement.versionCommand);
  if (result.failure?.kind === 'command-not-found') {
    throw new Error(formatMissingKubernetesInstallTool(requirement.binary));
  }
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read ${requirement.binary} version. ${requirement.installInstruction}`);
  }

  const foundVersion: string = readToolVersion(requirement, result.stdout);
  if (!isSemanticVersionAtLeast(foundVersion, requirement.minimumVersion)) {
    throw new Error(
      `${requirement.binary} ${foundVersion} is installed, but ${requirement.binary} >= ${requirement.minimumVersion} is required. ${requirement.installInstruction}`,
    );
  }
  return foundVersion;
}

export function formatMissingKubernetesInstallTool(binary: string): string {
  const requirement: KubernetesInstallLocalToolRequirement | undefined = kubernetesInstallLocalTools.find(
    (candidate: KubernetesInstallLocalToolRequirement): boolean => candidate.binary === binary,
  );
  return requirement === undefined
    ? `${binary} not found on PATH. Install ${binary} and re-run the command.`
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
  try {
    parseSemanticVersion(displayVersion);
  } catch {
    const requirement: KubernetesInstallLocalToolRequirement | undefined = kubernetesInstallLocalTools.find(
      (candidate: KubernetesInstallLocalToolRequirement): boolean => candidate.binary === binary,
    );
    throw new Error(
      `${binary} returned an unsupported version "${displayVersion}".${requirement === undefined ? '' : ` ${requirement.installInstruction}`}`,
    );
  }
  return displayVersion;
}
