import type { OutputFormat } from '../../output/output.types';
import type { DomainIssuerReference } from '@compartment/contracts';

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

export interface InstallWizardValues {
  ingress: InstallWizardIngressValues;
  registry?: InstallWizardRegistryValues | undefined;
  storage: InstallWizardStorageValues;
  tls?: InstallWizardTlsValues | undefined;
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
