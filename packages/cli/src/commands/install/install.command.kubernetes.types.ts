import type { KubernetesInstallInputValues } from './install.command.input.types';
import type { InstallWizardValues } from './install.command.types';
import type { MaterializedInstallWizardValues } from './install.command.values';

export type BoundaryInstallValues = Omit<KubernetesInstallInputValues, 'valuesPath'>;

export interface ResolvedInstallValuesPath {
  material?: MaterializedInstallWizardValues | undefined;
  path: string;
}

export interface ResolvedCommandInstallValues {
  input: BoundaryInstallValues;
  wizardValues?: InstallWizardValues | undefined;
}
