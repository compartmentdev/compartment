import type { OutputFormat } from '../../output/output.types';
import type { DomainIssuerReference } from '@compartment/contracts';

export interface InstallCommandOptions {
  adminPasswordFile?: string | undefined;
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
  check?: boolean | undefined;
  privilegedVmInstall?: boolean | undefined;
  privilegedVmHandoff?: string | undefined;
  releaseName?: string | undefined;
  registryIssuer?: string | undefined;
  remote?: string | undefined;
  storageClass?: string | undefined;
  tlsIssuer?: string | undefined;
  target?: 'kubernetes' | 'vm' | undefined;
  values?: string | undefined;
  yes?: boolean | undefined;
}

export interface ResolvedInstallIdentityPrompts {
  adminEmail: string;
  adminPassword: string;
  organizationName: string;
}

export interface InstallInputStream extends NodeJS.ReadableStream {
  isTTY?: boolean | undefined;
}

export interface InstallWizardValues {
  ingress: InstallWizardIngressValues;
  platform?: InstallWizardPlatformValues | undefined;
  registry?: InstallWizardRegistryValues | undefined;
  storage: InstallWizardStorageValues;
  tls?: InstallWizardTlsValues | undefined;
}

export interface InstallWizardPlatformValues {
  publicProtocol: 'http' | 'https';
}

export interface InstallWizardIngressValues {
  className: string;
}

export type InstallWizardIssuerReference = DomainIssuerReference;

export interface InstallWizardRegistryValues {
  issuerRef: InstallWizardIssuerReference;
}

export interface InstallWizardStorageValues {
  storageClass: string;
}

export interface InstallWizardTlsValues {
  existingSecret?: string | undefined;
  issuerRef?: InstallWizardIssuerReference | undefined;
}
