import type { CliInstallResult } from '../../install.types';
import type { OutputFormat } from '../../output/output.types';
import type { KubernetesInstallDomainMode } from '../../services/kubernetes-install.service.types';
import type { ResolvedKubernetesKubeconfig } from '../../services/kubernetes-install-kubeconfig.service.types';
import type { KubernetesInstallPreflightResult } from '../../services/kubernetes-install-preflight.service.types';

export interface InstallCommandOptions {
  adminPassword?: string | undefined;
  apiUrl?: string | undefined;
  baseDomain?: string | undefined;
  brokerUrl?: string | undefined;
  chart?: string | undefined;
  dev?: boolean | undefined;
  email?: string | undefined;
  ingressClass?: string | undefined;
  ingressEndpoint?: string | undefined;
  kubeContext?: string | undefined;
  managedDomain?: boolean | undefined;
  namespace?: string | undefined;
  organization?: string | undefined;
  organizationSlug?: string | undefined;
  output: OutputFormat;
  releaseName?: string | undefined;
  remote?: string | undefined;
  storageClass?: string | undefined;
  values?: string | undefined;
}

export interface ResolvedInstallIdentityPrompts {
  adminEmail: string;
  adminPassword: string;
  organizationName: string;
}

export interface ResolvedKubernetesInstallCommandOptions {
  apiUrl?: string | undefined;
  baseDomain?: string | undefined;
  brokerUrl?: string | undefined;
  chartPath?: string | undefined;
  domainMode: KubernetesInstallDomainMode;
  kubeconfigPath: string;
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
  valuesPath: string;
}

export interface KubernetesInstallTargetOptions {
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
}

export interface InstallWizardValues {
  storage: InstallWizardStorageValues;
}

export interface InstallWizardStorageValues {
  storageClass: string;
}

export interface PreparedKubernetesInstallCommandOptions extends InstallCommandOptions {
  values: string;
}

export interface PreparedKubernetesInstallResult {
  installOptions: ResolvedKubernetesInstallCommandOptions;
  result: CliInstallResult;
}

export interface InstallPreflightChecklistResult {
  kubeconfig: ResolvedKubernetesKubeconfig;
  preflight: KubernetesInstallPreflightResult;
}
