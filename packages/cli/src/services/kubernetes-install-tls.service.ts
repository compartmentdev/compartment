import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { parse } from 'yaml';

interface KubernetesInstallTlsValueFields {
  existingSecret?: string | undefined;
  issuerRef?: KubernetesInstallIssuerReference | undefined;
}

interface KubernetesInstallIssuerReference {
  kind: 'Issuer' | 'ClusterIssuer';
  name: string;
}
interface KubernetesInstallTlsValues {
  tls?: KubernetesInstallTlsValueFields | undefined;
}

const kubernetesInstallTlsValuesSchema: z.ZodType<KubernetesInstallTlsValues> = z
  .object({
    tls: z
      .object({
        existingSecret: z.string().optional(),
        issuerRef: z
          .object({
            kind: z.enum(['Issuer', 'ClusterIssuer']),
            name: z.string().min(1),
          })
          .strict()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export async function usesOperatorOwnedKubernetesTlsSecret(valuesPath: string): Promise<boolean> {
  const values: KubernetesInstallTlsValues = kubernetesInstallTlsValuesSchema.parse(
    parse(await readFile(valuesPath, 'utf8')) ?? {},
  );
  return (values.tls?.existingSecret ?? '').trim() !== '';
}

export async function readOperatorOwnedKubernetesTlsSecretName(valuesPath: string): Promise<string> {
  const values: KubernetesInstallTlsValues = kubernetesInstallTlsValuesSchema.parse(
    parse(await readFile(valuesPath, 'utf8')) ?? {},
  );
  const secretName: string = (values.tls?.existingSecret ?? '').trim();
  if (secretName === '') {
    throw new Error('tls.existingSecret is required in --values for operator-owned TLS.');
  }
  return secretName;
}

export async function readKubernetesTlsIssuerReference(valuesPath: string): Promise<KubernetesInstallIssuerReference> {
  const values: KubernetesInstallTlsValues = kubernetesInstallTlsValuesSchema.parse(
    parse(await readFile(valuesPath, 'utf8')) ?? {},
  );
  const issuerRef: KubernetesInstallIssuerReference | undefined = values.tls?.issuerRef;
  if (issuerRef === undefined) {
    throw new Error('tls.issuerRef.name and tls.issuerRef.kind are required in --values for issuer-managed TLS.');
  }
  return issuerRef;
}
