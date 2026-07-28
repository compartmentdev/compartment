import { managedDomainTargetSchema } from '@compartment/contracts';
import { parseJsonWith } from '@compartment/utils';
import { z } from 'zod';
import type { KubernetesIngressEndpoint } from './kubernetes-install.service.types';

const ingressTargetsSchema: z.ZodType<KubernetesIngressEndpoint[]> = z.array(managedDomainTargetSchema);

export function parseKubernetesIngressTargetsJson(value: string, label: string): KubernetesIngressEndpoint[] {
  try {
    return parseJsonWith(ingressTargetsSchema, value);
  } catch {
    throw new Error(`${label} has invalid ingress targets.`);
  }
}
