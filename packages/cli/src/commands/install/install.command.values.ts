import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  createKubernetesInstallMaterializedDirectory,
  writeKubernetesInstallValues,
} from '../../services/kubernetes-install-helm.service';
import type { InstallWizardValues } from './install.command.types';

export interface MaterializedInstallWizardValues {
  directory: string;
  path: string;
}

export interface OperatorInstallInputValues {
  ingressClass: string;
  storageClass: string;
}

interface OperatorInstallValuesDocument {
  ingress: OperatorInstallIngressValues;
  storage?: OperatorInstallStorageValues | undefined;
}

interface OperatorInstallIngressValues {
  className: string;
}

interface OperatorInstallStorageValues {
  storageClass?: string | undefined;
}

const operatorInstallValuesSchema: z.ZodType<OperatorInstallValuesDocument> = z
  .object({
    ingress: z.object({ className: z.string().min(1) }).passthrough(),
    storage: z.object({ storageClass: z.string() }).passthrough().optional(),
  })
  .passthrough();

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

export async function readOperatorInstallInputValues(valuesPath: string): Promise<OperatorInstallInputValues> {
  const source: string = await readFile(valuesPath, 'utf8');
  const values: OperatorInstallValuesDocument = operatorInstallValuesSchema.parse(parse(source));
  return {
    ingressClass: values.ingress.className,
    storageClass: values.storage?.storageClass ?? '',
  };
}
