import type { JsonValue } from '@compartment/utils';
import { z } from 'zod';
import { formatSchemaValidationError } from './schema-validation-error';
import { readYamlFile, type YamlFileValue } from './yaml-file';

interface KubernetesSandboxRuntimeSourceValues {
  sandboxRuntime?: KubernetesSandboxRuntimeValueFields | undefined;
}

interface KubernetesSandboxRuntimeValueFields {
  runtimeClassName?: string | undefined;
}

const sandboxRuntimeValuesSchema: z.ZodType<KubernetesSandboxRuntimeSourceValues> = z
  .object({
    sandboxRuntime: z
      .object({
        runtimeClassName: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export async function resolveKubernetesSandboxRuntimeClassName(
  chartValues: JsonValue,
  valuesPath: string,
): Promise<string> {
  const chartRuntimeClassName: string | undefined = parseSandboxRuntimeClassName(chartValues, 'Helm chart defaults');
  const parsed: YamlFileValue = await readYamlFile(valuesPath, 'operator values file');
  return parseSandboxRuntimeClassName(parsed, valuesPath) ?? chartRuntimeClassName ?? '';
}

function parseSandboxRuntimeClassName(values: JsonValue | YamlFileValue, source: string): string | undefined {
  const result: z.SafeParseReturnType<YamlFileValue, KubernetesSandboxRuntimeSourceValues> =
    sandboxRuntimeValuesSchema.safeParse(values);
  if (!result.success) {
    throw formatSchemaValidationError(result.error, source);
  }
  return result.data.sandboxRuntime?.runtimeClassName;
}
