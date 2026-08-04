export type InstallTarget = 'kubernetes' | 'vm';

export interface InstallTargetSelectionInput {
  explicitTarget?: InstallTarget | undefined;
  interactive: boolean;
  kubeconfigPaths: readonly string[];
  managedStateExists: boolean;
}
