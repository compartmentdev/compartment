import type { KubernetesInstallInput } from '../../services/kubernetes-install-input.service.types';

export interface KubernetesInstallInputValues {
  baseDomain?: string | undefined;
  clearIngressEndpoint?: boolean | undefined;
  email?: string | undefined;
  ingressClass?: string | undefined;
  ingressEndpoint?: string | undefined;
  kubeContext?: string | undefined;
  managedDomain?: boolean | undefined;
  namespace?: string | undefined;
  organization?: string | undefined;
  password?: string | undefined;
  publicProtocol?: 'http' | 'https' | undefined;
  releaseName?: string | undefined;
  storageClass?: string | undefined;
  valuesPath: string;
}

export interface ResolvedKubernetesInstallInput {
  input: KubernetesInstallInput;
}

export interface RequiredKubernetesInstallInputValues {
  email: string;
  ingressClass: string;
  kubeContext: string;
  namespace: string;
  organizationName: string;
  password: string;
  releaseName: string;
  storageClass: string;
}
