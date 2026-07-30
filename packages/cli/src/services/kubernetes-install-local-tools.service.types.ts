export interface KubernetesInstallLocalToolRequirement {
  binary: 'helm' | 'kubectl';
  installInstruction: string;
  minimumVersion: string;
  versionCommand: readonly string[];
}

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string | undefined;
}

export interface KubectlVersionOutput {
  clientVersion?: KubectlClientVersion | undefined;
}

export interface KubectlClientVersion {
  gitVersion?: string | undefined;
}
