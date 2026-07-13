import type { EffectiveVariable } from './effective-variables.service.types';
import { resolveResourceOutputSummary } from './resource-output-resolution.service';
import type { ResourceLookupResult, ResourceOutputInput, ResourceOutputSummaryInput } from './resources.service.types';

export function resolveResourceOutputForLookup(
  input: ResourceOutputInput,
  lookup: ResourceLookupResult,
  effectiveVariables: EffectiveVariable[],
  reveal: boolean,
): ResourceOutputSummaryInput {
  return resolveResourceOutputSummary(
    input.query.outputName,
    {
      environmentName: lookup.environment.name,
      namespaceId: lookup.project.id,
      projectName: lookup.project.name,
      resource: lookup.resource,
    },
    effectiveVariables,
    reveal,
  );
}
