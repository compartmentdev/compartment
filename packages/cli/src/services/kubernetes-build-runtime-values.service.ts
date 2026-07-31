import type { JsonValue } from '@compartment/utils';
import { z } from 'zod';
import { formatSchemaValidationError } from './schema-validation-error';
import { readYamlFile, type YamlFileValue } from './yaml-file';

interface KubernetesBuildRuntimeSourceValues {
  buildkit?: KubernetesBuildRuntimeValueFields | undefined;
}

interface KubernetesBuildRuntimeValueFields {
  runtimeClassName?: string | undefined;
}

const buildRuntimeValuesSchema: z.ZodType<KubernetesBuildRuntimeSourceValues> = z
  .object({
    buildkit: z
      .object({
        runtimeClassName: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export async function resolveKubernetesBuildRuntimeClassName(
  chartValues: JsonValue,
  valuesPath: string,
): Promise<string> {
  const chartRuntimeClassName: string | undefined = parseBuildRuntimeClassName(chartValues, 'Helm chart defaults');
  const parsed: YamlFileValue = await readYamlFile(valuesPath, 'operator values file');
  return parseBuildRuntimeClassName(parsed, valuesPath) ?? chartRuntimeClassName ?? '';
}

function parseBuildRuntimeClassName(values: JsonValue | YamlFileValue, source: string): string | undefined {
  const result: z.SafeParseReturnType<YamlFileValue, KubernetesBuildRuntimeSourceValues> =
    buildRuntimeValuesSchema.safeParse(values);
  if (!result.success) {
    throw formatSchemaValidationError(result.error, source);
  }
  return result.data.buildkit?.runtimeClassName;
}
