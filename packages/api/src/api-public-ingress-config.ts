import { managedDomainTargetSchema, type ManagedDomainTarget } from '@compartment/contracts';
import { z } from 'zod';

interface ApiPublicIngressConfigEnv {
  COMPARTMENT_INGRESS_TARGETS_JSON: string;
}

export interface ApiPublicIngressConfig {
  targets: ManagedDomainTarget[];
}

const apiPublicIngressConfigSchema: z.ZodType<ApiPublicIngressConfigEnv> = z.object({
  COMPARTMENT_INGRESS_TARGETS_JSON: z.string().min(1),
});
const ingressTargetsSchema: z.ZodType<ManagedDomainTarget[]> = z
  .array(managedDomainTargetSchema)
  .superRefine((targets: ManagedDomainTarget[], context: z.RefinementCtx): void => {
    const hasHostname: boolean = targets.some((target: ManagedDomainTarget): boolean => target.type === 'hostname');
    const hasAddress: boolean = targets.some((target: ManagedDomainTarget): boolean => target.type !== 'hostname');
    if (hasHostname && hasAddress) {
      context.addIssue({
        code: 'custom',
        message: 'Ingress targets must contain either hostnames or addresses, not both.',
      });
    }
  });

export function readApiPublicIngressConfig(env: NodeJS.ProcessEnv = process.env): ApiPublicIngressConfig {
  const parsed: ApiPublicIngressConfigEnv = apiPublicIngressConfigSchema.parse(env);
  return {
    targets: ingressTargetsSchema.parse(JSON.parse(parsed.COMPARTMENT_INGRESS_TARGETS_JSON)),
  };
}
