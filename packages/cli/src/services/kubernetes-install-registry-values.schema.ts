import { z } from 'zod';
import { kubernetesResourceNameSchema } from './kubernetes-resource-name';
import type { KubernetesInstallRegistryIssuerValueFields } from './kubernetes-install-registry.service.types';

export const kubernetesInstallRegistryIssuerValueFieldsSchema: z.ZodType<KubernetesInstallRegistryIssuerValueFields> = z
  .object({
    group: z.literal('cert-manager.io').optional(),
    kind: z.enum(['Issuer', 'ClusterIssuer']),
    name: kubernetesResourceNameSchema,
  })
  .strict();
