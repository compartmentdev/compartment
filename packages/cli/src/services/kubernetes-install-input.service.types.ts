import type { CliInstallResult } from '../install.types';
import type { KubernetesInstallProgressReporter } from './kubernetes-install-progress.types';

export interface KubernetesInstallOwnerInput {
  email: string;
  organizationName: string;
  password: string;
}

export interface ManagedKubernetesInstallDomain {
  mode: 'managed';
}

export interface OperatorKubernetesInstallDomain {
  baseDomain: string;
  mode: 'operator';
  publicProtocol: 'http' | 'https';
}

export type KubernetesInstallDomainInput = ManagedKubernetesInstallDomain | OperatorKubernetesInstallDomain;

export interface KubernetesInstallInput {
  clearIngressEndpoint: boolean;
  domain: KubernetesInstallDomainInput;
  ingressClass: string;
  ingressEndpoint?: string | undefined;
  kubeContext: string;
  kubeconfigPath: string;
  namespace: string;
  owner: KubernetesInstallOwnerInput;
  releaseName: string;
  storageClass: string;
  valuesPath: string;
}

export interface KubernetesInstallApplicationInput extends KubernetesInstallInput {
  apiUrl?: string | undefined;
  brokerUrl?: string | undefined;
  chartPath?: string | undefined;
  organizationSlug?: string | undefined;
  progress: KubernetesInstallProgressReporter;
}

export interface KubernetesInstallApplicationResult {
  install: CliInstallResult;
}
