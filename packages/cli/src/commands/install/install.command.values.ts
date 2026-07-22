import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstallWizardValues } from './install.command.types';

export interface MaterializedInstallWizardValues {
  directory: string;
  path: string;
}

export async function materializeInstallWizardValues(
  values: InstallWizardValues,
): Promise<MaterializedInstallWizardValues> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-install-wizard-'));
  const path: string = join(directory, 'values.json');
  await writeFile(path, JSON.stringify(values), { mode: 0o600 });
  return { directory, path };
}

export async function removeInstallWizardValues(material: MaterializedInstallWizardValues): Promise<void> {
  await rm(material.directory, { force: true, recursive: true });
}
