import type { DomainIssuerReference } from '@compartment/contracts';
import { z } from 'zod';
import { kubernetesResourceNameSchema } from './kubernetes-resource-name';

export interface KubernetesInstallTlsValueFields {
  existingSecret?: string | undefined;
  issuerRef?: DomainIssuerReference | undefined;
}

export const kubernetesInstallTlsValueFieldsSchema: z.ZodType<KubernetesInstallTlsValueFields> = z
  .object({
    existingSecret: kubernetesResourceNameSchema.or(z.literal('')).optional(),
    issuerRef: z
      .object({
        kind: z.enum(['Issuer', 'ClusterIssuer']),
        name: kubernetesResourceNameSchema,
      })
      .strict()
      .optional(),
  })
  .passthrough();
