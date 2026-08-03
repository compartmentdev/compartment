import type { KubernetesInstallInputValues } from './install.command.input.types';
import type {
  InstallWizardIssuerReference,
  InstallWizardRegistryValues,
  InstallWizardTlsValues,
  InstallWizardValues,
} from './install.command.types';
import type {
  KubernetesContextChoice,
  KubernetesInstallInventory,
  KubernetesInstallResourceInventory,
  KubernetesStorageClassChoice,
} from '../../services/kubernetes-install-inventory.service.types';
import type { KubernetesOperatorIssuerAssessment } from '../../services/kubernetes-operator-issuer-trust.service.types';
import type { RetainedKubernetesInstallState } from '../../services/kubernetes-install.service.types';

export type KubernetesInstallWizardInventory = KubernetesInstallInventory;
export type ReadKubernetesInstallResourceInventory = (
  contextName: string,
) => Promise<KubernetesInstallResourceInventory>;
export type InspectKubernetesInstallIssuer = (
  contextName: string,
  namespace: string,
  issuer: InstallWizardIssuerReference,
) => Promise<KubernetesOperatorIssuerAssessment>;
export type ReadKubernetesInstallRetainedState = (
  contextName: string,
  namespace: string,
  releaseName: string,
) => Promise<RetainedKubernetesInstallState | null>;
export type { KubernetesContextChoice, KubernetesStorageClassChoice };

export interface KubernetesInstallWizardResult {
  input: Omit<KubernetesInstallInputValues, 'valuesPath'>;
  values: InstallWizardValues;
}

export interface KubernetesInstallWizardDomain {
  input: Pick<KubernetesInstallInputValues, 'baseDomain' | 'managedDomain'>;
  registry?: InstallWizardRegistryValues | undefined;
  tls?: InstallWizardTlsValues | undefined;
  tlsReview: string;
}

export interface KubernetesInstallWizardOwner {
  email: string;
  organization: string;
  password: string;
}

export interface ResolvedKubernetesInstallWizardReview {
  domain: KubernetesInstallWizardDomain;
  input: Omit<KubernetesInstallInputValues, 'valuesPath'>;
}

export interface KubernetesInstallWizardClusterSelection {
  ingressClass: string;
  kubeContext: string;
  storageClass: string;
}
