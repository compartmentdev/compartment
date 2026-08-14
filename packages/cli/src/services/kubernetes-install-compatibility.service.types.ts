export interface ManagedKubernetesInstallArtifact {
  name: 'cert-manager' | 'gvisor' | 'helm' | 'k3s' | 'k3s-install-script';
  sha256: string;
  sha512?: string | undefined;
  url: string;
  version: string;
}

export interface ManagedKubernetesInstallCompatibility {
  certManager: ManagedKubernetesInstallArtifact;
  gvisor: ManagedKubernetesInstallArtifact;
  helm: ManagedKubernetesInstallArtifact;
  k3s: ManagedKubernetesInstallArtifact;
  k3sChannel: string;
  k3sInstallScript: ManagedKubernetesInstallArtifact;
  kubernetesMinor: string;
}

export interface KubernetesInstallCompatibility {
  helmMinimumVersion: string;
  kubernetesMinimumVersion: string;
  kubectlMaximumMinorSkew: number;
  kubectlMinimumVersion: string;
  managed: ManagedKubernetesInstallCompatibility;
}

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string | undefined;
}
