import type { KubernetesInstallInputValues } from './install.command.input.types';
import type { InstallWizardRegistryValues, InstallWizardTlsValues, InstallWizardValues } from './install.command.types';
import type {
  KubernetesContextChoice,
  KubernetesInstallInventory,
  KubernetesInstallResourceInventory,
  KubernetesStorageClassChoice,
} from '../../services/kubernetes-install-inventory.service.types';

export type KubernetesInstallWizardInventory = KubernetesInstallInventory;
export type ReadKubernetesInstallResourceInventory = (
  contextName: string,
) => Promise<KubernetesInstallResourceInventory>;
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
