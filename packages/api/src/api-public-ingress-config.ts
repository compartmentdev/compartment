import { publicIngressTargetSchema, type PublicIngressTarget } from '@compartment/contracts';
import { z } from 'zod';

export type ApiPublicIngressTarget = PublicIngressTarget;

interface ApiPublicIngressConfigEnv {
  COMPARTMENT_INGRESS_TARGETS_JSON: string;
}

export interface ApiPublicIngressConfig {
  targets: ApiPublicIngressTarget[];
}

const apiPublicIngressConfigSchema: z.ZodType<ApiPublicIngressConfigEnv> = z.object({
  COMPARTMENT_INGRESS_TARGETS_JSON: z.string().min(1),
});
const ingressTargetsSchema: z.ZodType<ApiPublicIngressTarget[]> = z
  .array(publicIngressTargetSchema)
  .superRefine((targets: ApiPublicIngressTarget[], context: z.RefinementCtx): void => {
    const hasHostname: boolean = targets.some((target: ApiPublicIngressTarget): boolean => target.type === 'hostname');
    const hasAddress: boolean = targets.some((target: ApiPublicIngressTarget): boolean => target.type !== 'hostname');
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
