import type { KubernetesInstallInputValues } from './install.command.input.types';
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
}
