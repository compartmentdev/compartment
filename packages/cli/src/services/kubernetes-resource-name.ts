import { z } from 'zod';

const kubernetesResourceNamePattern: RegExp = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/u;

export const kubernetesResourceNameSchema: z.ZodString = z
  .string()
  .trim()
  .min(1, 'must not be empty')
  .max(253, 'must be at most 253 characters')
  .regex(kubernetesResourceNamePattern, 'must be a valid Kubernetes resource name');

export function validateKubernetesResourceName(value: string, label: string): string | undefined {
  const result: z.SafeParseReturnType<string, string> = kubernetesResourceNameSchema.safeParse(value);
  if (!result.success) {
    return `${label} ${result.error.issues[0]?.message ?? 'is invalid'}.`;
  }
  return undefined;
}
