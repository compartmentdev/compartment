import { createHash } from 'node:crypto';
import type { OrganizationQuotaCapacity, ProjectContainerDefaults, ProjectQuota } from '@compartment/kube-runtime';
import type { JsonValue } from '@compartment/utils';
import { z } from 'zod';

const kubernetesQuantityPattern: RegExp =
  /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[numkMGTPE]|[KMGTPE]i|[eE][+-]?[0-9]+)?$/u;
const kubernetesQuantitySchema: z.ZodString = z
  .string()
  .regex(kubernetesQuantityPattern, 'must be a valid non-negative Kubernetes quantity');
const computeResourcesSchema = z.object({ cpu: kubernetesQuantitySchema, memory: kubernetesQuantitySchema }).strict();
const projectContainerDefaultsSchema: z.ZodType<ProjectContainerDefaults> = z
  .object({ limit: computeResourcesSchema, request: computeResourcesSchema })
  .strict();
const quotaSchema: z.ZodType<ProjectQuota> = z
  .object({
    limitsCpu: kubernetesQuantitySchema,
    limitsMemory: kubernetesQuantitySchema,
    requestsCpu: kubernetesQuantitySchema,
    requestsMemory: kubernetesQuantitySchema,
    requestsStorage: kubernetesQuantitySchema,
  })
  .strict();

export function readProjectContainerDefaults(value: string, name: string): ProjectContainerDefaults {
  return readResourceConfiguration(value, name, projectContainerDefaultsSchema);
}

export function readProjectQuota(value: string, name: string): ProjectQuota {
  return readResourceConfiguration(value, name, quotaSchema);
}

export function readOrganizationQuota(value: string, name: string): OrganizationQuotaCapacity {
  return readResourceConfiguration(value, name, quotaSchema);
}

export function projectResourceConfigurationFingerprint(
  containerDefaults: ProjectContainerDefaults,
  quota: ProjectQuota,
): string {
  const projectionVersion: number = 1;
  return createHash('sha256').update(JSON.stringify({ containerDefaults, projectionVersion, quota })).digest('hex');
}

function readResourceConfiguration<T>(value: string, name: string, schema: z.ZodType<T>): T {
  let input: JsonValue;
  try {
    input = JSON.parse(value) as JsonValue;
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  const parsed: z.SafeParseReturnType<JsonValue, T> = schema.safeParse(input);
  if (!parsed.success) {
    const issue: z.ZodIssue | undefined = parsed.error.issues[0];
    const path: string = issue?.path.join('.') ?? 'value';
    const message: string = issue?.message ?? 'is invalid';
    throw new Error(`${name} ${path} ${message}.`);
  }
  return parsed.data;
}
