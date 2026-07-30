import type { DomainIssuerReference } from '@compartment/contracts';
import { z } from 'zod';
import { formatSchemaValidationError } from './schema-validation-error';
import { readYamlFile, type YamlFileValue } from './yaml-file';
import {
  kubernetesInstallTlsValueFieldsSchema,
  type KubernetesInstallTlsValueFields,
} from './kubernetes-install-tls-values.schema';

interface KubernetesInstallTlsValues {
  tls?: KubernetesInstallTlsValueFields | undefined;
}

const kubernetesInstallTlsValuesSchema: z.ZodType<KubernetesInstallTlsValues> = z
  .object({
    tls: kubernetesInstallTlsValueFieldsSchema.optional(),
  })
  .passthrough();

export async function usesOperatorOwnedKubernetesTlsSecret(valuesPath: string): Promise<boolean> {
  const values: KubernetesInstallTlsValues = await readTlsValues(valuesPath);
  return (values.tls?.existingSecret ?? '').trim() !== '';
}

export async function readOperatorOwnedKubernetesTlsSecretName(valuesPath: string): Promise<string> {
  const values: KubernetesInstallTlsValues = await readTlsValues(valuesPath);
  const secretName: string = (values.tls?.existingSecret ?? '').trim();
  if (secretName === '') {
    throw new Error('tls.existingSecret is required in --values for operator-owned TLS.');
  }
  return secretName;
}

export async function readKubernetesTlsIssuerReference(valuesPath: string): Promise<DomainIssuerReference> {
  const values: KubernetesInstallTlsValues = await readTlsValues(valuesPath);
  const issuerRef: DomainIssuerReference | undefined = values.tls?.issuerRef;
  if (issuerRef === undefined) {
    throw new Error('tls.issuerRef.name and tls.issuerRef.kind are required in --values for issuer-managed TLS.');
  }
  return issuerRef;
}

async function readTlsValues(valuesPath: string): Promise<KubernetesInstallTlsValues> {
  const parsed: YamlFileValue = await readYamlFile(valuesPath, 'operator values file');
  const result: z.SafeParseReturnType<YamlFileValue, KubernetesInstallTlsValues> =
    kubernetesInstallTlsValuesSchema.safeParse(parsed);
  if (!result.success) {
    throw formatSchemaValidationError(result.error, valuesPath);
  }
  return result.data;
}
