import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createKubernetesInstallMaterializedDirectory,
  writeKubernetesInstallValues,
} from '../../services/kubernetes-install-helm.service';
import type { InstallWizardValues } from './install.command.types';

export interface MaterializedInstallWizardValues {
  directory: string;
  path: string;
}

export async function materializeInstallWizardValues(
  values: InstallWizardValues,
): Promise<MaterializedInstallWizardValues> {
  const directory: string = await createKubernetesInstallMaterializedDirectory();
  const path: string = join(directory, 'values.json');
  await writeKubernetesInstallValues(path, values);
  return { directory, path };
}

export async function removeInstallWizardValues(material: MaterializedInstallWizardValues): Promise<void> {
  await rm(material.directory, { force: true, recursive: true });
}
