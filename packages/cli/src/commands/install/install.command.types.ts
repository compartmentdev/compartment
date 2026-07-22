import type { OutputFormat } from '../../output/output.types';
import type { KubernetesInstallDomainMode } from '../../services/kubernetes-install.service.types';
import type {
  KubernetesInstallPreflightResult,
  ResolvedKubernetesKubeconfig,
} from '../../services/kubernetes-install-preflight.service.types';
import type { MaterializedInstallWizardValues } from './install.command.values';

export interface InstallCommandOptions {
  apiUrl?: string | undefined;
  baseDomain?: string | undefined;
  brokerUrl?: string | undefined;
  chart?: string | undefined;
  dev?: boolean | undefined;
  email?: string | undefined;
  kubeContext?: string | undefined;
  managedDomain?: boolean | undefined;
  namespace?: string | undefined;
  organization?: string | undefined;
  organizationSlug?: string | undefined;
  output: OutputFormat;
  releaseName?: string | undefined;
  remote?: string | undefined;
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

export interface InstallWizardAnswers {
  baseDomain?: string | undefined;
  customTlsSecret?: string | undefined;
  domainMode: KubernetesInstallDomainMode;
  storageClass: string;
  tlsMode?: 'custom-cert' | 'custom-http' | undefined;
}

export interface InstallWizardValues {
  customTls?: InstallWizardCustomTlsValues | undefined;
  platform?: InstallWizardPlatformValues | undefined;
  storage: InstallWizardStorageValues;
}

export interface InstallWizardCustomTlsValues {
  existingSecret: string;
}

export interface InstallWizardPlatformValues {
  tlsMode: 'custom-cert' | 'custom-http';
}

export interface InstallWizardStorageValues {
  storageClass: string;
}

export interface InstallWizardResolution {
  answers: InstallWizardAnswers;
  values: InstallWizardValues;
}

export interface PreparedInstallCommandInput {
  material: MaterializedInstallWizardValues | null;
  options: InstallCommandOptions;
}

export interface InstallPreflightChecklistResult {
  kubeconfig: ResolvedKubernetesKubeconfig;
  preflight: KubernetesInstallPreflightResult;
}
