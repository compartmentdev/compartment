import { defaultCompartmentEnvironmentName } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import { insertVariableAccessEvent } from '../queries/variables.query';
import type { InsertVariableAccessEventInput } from '../queries/variables.query.types';
import { requireEnvironmentPermission } from './deployment-context.service.scope';
import type { ResourceLookupResult, ResourceOutputInput, ResourceOutputSummaryInput } from './resources.service.types';

export async function requireResourceOutputRevealPermission(
  input: ResourceOutputInput,
  lookup: ResourceLookupResult,
  reveal: boolean,
): Promise<void> {
  if (!reveal) {
    return;
  }

  await requireEnvironmentPermission(
    input.actorPrincipalId,
    lookup.organization.id,
    lookup.environment.id,
    'variable.value.read',
  );
}

export async function auditResourceOutputReveal(
  input: ResourceOutputInput,
  lookup: ResourceLookupResult,
  output: ResourceOutputSummaryInput,
  reveal: boolean,
): Promise<void> {
  if (!reveal || output.sensitivity !== 'sensitive') {
    return;
  }

  await insertVariableAccessEvent(buildResourceOutputRevealAccessEventInput(input, lookup, output.valueFingerprint));
}

function buildResourceOutputRevealAccessEventInput(
  input: ResourceOutputInput,
  lookup: ResourceLookupResult,
  valueFingerprint: string | null,
): InsertVariableAccessEventInput {
  return {
    actorPrincipalId: input.actorPrincipalId,
    commandName: null,
    environmentId: lookup.environment.id,
    fingerprintsJson: JSON.stringify({ [input.query.outputName]: valueFingerprint }),
    id: createId('vae'),
    keyNamesJson: JSON.stringify([input.query.outputName]),
    operation: 'resource_output_reveal',
    organizationId: lookup.organization.id,
    production: lookup.environment.name === defaultCompartmentEnvironmentName,
    projectId: lookup.project.id,
    projectServiceId: null,
    targetResourceName: lookup.resource.name,
    sensitivityJson: JSON.stringify({ [input.query.outputName]: 'sensitive' }),
    targetEnvironmentName: lookup.environment.name,
    targetProjectName: lookup.project.name,
    targetServiceName: null,
  };
}
