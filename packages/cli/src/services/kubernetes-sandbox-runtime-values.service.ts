import type { JsonValue } from '@compartment/utils';
import { z } from 'zod';
import { formatSchemaValidationError } from './schema-validation-error';
import { readYamlFile, type YamlFileValue } from './yaml-file';

interface KubernetesSandboxRuntimeSourceValues {
  sandboxRuntime?: KubernetesSandboxRuntimeValueFields | undefined;
}

interface KubernetesSandboxRuntimeValueFields {
  buildRuntimeClassName?: string | undefined;
  runtimeClassName?: string | undefined;
}

export interface KubernetesSandboxRuntimeClassNames {
  build: string;
  tenant: string;
}

const sandboxRuntimeValuesSchema: z.ZodType<KubernetesSandboxRuntimeSourceValues> = z
  .object({
    sandboxRuntime: z
      .object({
        buildRuntimeClassName: z.string().optional(),
        runtimeClassName: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export async function resolveKubernetesSandboxRuntimeClassNames(
  chartValues: JsonValue,
  valuesPath: string,
): Promise<KubernetesSandboxRuntimeClassNames> {
  const chartRuntime: KubernetesSandboxRuntimeValueFields = parseSandboxRuntimeClassNames(
    chartValues,
    'Helm chart defaults',
  );
  const parsed: YamlFileValue = await readYamlFile(valuesPath, 'operator values file');
  const overrideRuntime: KubernetesSandboxRuntimeValueFields = parseSandboxRuntimeClassNames(parsed, valuesPath);
  return {
    build: overrideRuntime.buildRuntimeClassName ?? chartRuntime.buildRuntimeClassName ?? '',
    tenant: overrideRuntime.runtimeClassName ?? chartRuntime.runtimeClassName ?? '',
  };
}

function parseSandboxRuntimeClassNames(
  values: JsonValue | YamlFileValue,
  source: string,
): KubernetesSandboxRuntimeValueFields {
  const result: z.SafeParseReturnType<YamlFileValue, KubernetesSandboxRuntimeSourceValues> =
    sandboxRuntimeValuesSchema.safeParse(values);
  if (!result.success) {
    throw formatSchemaValidationError(result.error, source);
  }
  return result.data.sandboxRuntime ?? {};
}
