import {
  buildResourceOutputReference,
  parseResourceOutputReference,
  type CompartmentResourceOutputConfig,
  type ResourceOutputReference,
} from '@compartment/contracts';
import { createInvalidVariableTargetError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { findProjectResourceByName } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import {
  deleteEnvironmentResourceOutputVariableBindingWithAudit,
  upsertEnvironmentResourceOutputVariableBindingWithAudit,
} from '../queries/variables-resource-output.query';
import type {
  InsertVariableChangeEventInput,
  UpsertEnvironmentResourceOutputVariableBindingInput,
} from '../queries/variables.query.types';
import { parseStoredResourceOutputs } from './resources.service.storage';
import { failMissingServiceName } from './variables.service.helpers';
import type {
  RemoveVariableInput,
  SetVariableInput,
  VariableDetailResult,
  VariableResult,
  VariableTargetContext,
} from './variables.service.types';
import { assertNoDirectServiceVariableConflict } from './variables.resource-output-conflicts.service';

interface ResolvedResourceOutputVariableResult {
  sensitivity: 'plain' | 'sensitive';
}

export async function setResourceOutputVariableForPrincipal(
  input: SetVariableInput,
  target: VariableTargetContext,
  now: Date,
): Promise<VariableResult> {
  const reference: ResourceOutputReference = readResourceOutputReference(input.fromResource);
  await assertNoDirectServiceVariableConflict(input, target);
  await upsertEnvironmentResourceOutputVariableBindingWithAudit(
    buildUpsertResourceOutputVariableBindingInput(input, target, reference, now),
    buildSetResourceOutputVariableChangeEventInput(input, target, reference),
  );

  return {
    environment: target.environment,
    project: target.project,
    resourceName: target.resourceName,
    serviceName: target.serviceName,
    variable: await buildResourceOutputVariableResult(input, target, reference),
  };
}

export async function removeResourceOutputVariableBinding(
  input: RemoveVariableInput,
  target: VariableTargetContext,
): Promise<boolean> {
  if (target.serviceName === null || target.resourceName !== null) {
    return false;
  }

  return await deleteEnvironmentResourceOutputVariableBindingWithAudit(
    {
      environmentId: target.environment.id,
      keyName: input.keyName,
      targetServiceName: target.serviceName,
    },
    buildRemoveResourceOutputVariableChangeEventInput(input, target),
  );
}

function readResourceOutputReference(value: string | undefined): ResourceOutputReference {
  if (value === undefined) {
    throw createInvalidVariableTargetError('Resource output binding requires fromResource.');
  }
  const reference: ResourceOutputReference | null = parseResourceOutputReference(value);
  if (reference === null) {
    throw createInvalidVariableTargetError('Resource output binding must use resource.output.');
  }

  return reference;
}

async function buildResourceOutputVariableResult(
  input: SetVariableInput,
  target: VariableTargetContext,
  reference: ResourceOutputReference,
): Promise<VariableDetailResult> {
  const resolvedOutput: ResolvedResourceOutputVariableResult | null = await resolveResourceOutputVariableResult(
    target,
    reference,
  );

  return {
    keyName: input.keyName,
    scopeResourceName: null,
    scopeServiceName: target.serviceName,
    scopeType: 'service',
    sensitivity: resolvedOutput?.sensitivity ?? 'sensitive',
    sourceResourceOutput: input.fromResource ?? null,
    sourceType: 'resource_output',
    sourceVariableSetName: null,
    value: null,
    valueHidden: true,
  };
}

async function resolveResourceOutputVariableResult(
  target: VariableTargetContext,
  reference: ResourceOutputReference,
): Promise<ResolvedResourceOutputVariableResult | null> {
  const resource: ProjectResourceRow | undefined = await findProjectResourceByName(
    target.environment.id,
    reference.resourceName,
  );
  if (resource === undefined) {
    return null;
  }

  const outputSensitivity: 'plain' | 'sensitive' | null = readStoredResourceOutputSensitivity(resource, reference);
  if (outputSensitivity === null) {
    return null;
  }
  return {
    sensitivity: outputSensitivity,
  };
}

export function readStoredResourceOutputSensitivity(
  resource: ProjectResourceRow,
  reference: ResourceOutputReference,
): 'plain' | 'sensitive' | null {
  const output: CompartmentResourceOutputConfig | undefined =
    parseStoredResourceOutputs(resource)[reference.outputName];
  if (output === undefined) {
    return null;
  }

  return output.sensitive ? 'sensitive' : 'plain';
}

function buildUpsertResourceOutputVariableBindingInput(
  input: SetVariableInput,
  target: VariableTargetContext,
  reference: ResourceOutputReference,
  now: Date,
): UpsertEnvironmentResourceOutputVariableBindingInput {
  return {
    createdByPrincipalId: input.principalId,
    environmentId: target.environment.id,
    id: createId('vrob'),
    keyName: input.keyName,
    outputName: reference.outputName,
    resourceName: reference.resourceName,
    source: 'cli',
    targetServiceName: target.serviceName ?? failMissingServiceName(),
    updatedAt: now,
    updatedByPrincipalId: input.principalId,
  };
}

function buildSetResourceOutputVariableChangeEventInput(
  input: SetVariableInput,
  target: VariableTargetContext,
  reference: ResourceOutputReference,
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId: input.principalId,
    fingerprintsJson: JSON.stringify([buildResourceOutputReference(reference)]),
    keyNamesJson: JSON.stringify([input.keyName]),
    operation: 'set',
    organizationId: target.organization.id,
    sensitivityJson: JSON.stringify(['resource_output']),
    targetId: target.service?.id ?? target.serviceName ?? target.environment.id,
    targetType: 'service',
  };
}

function buildRemoveResourceOutputVariableChangeEventInput(
  input: RemoveVariableInput,
  target: VariableTargetContext,
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId: input.principalId,
    keyNamesJson: JSON.stringify([input.keyName]),
    operation: 'remove',
    organizationId: target.organization.id,
    targetId: target.service?.id ?? target.serviceName ?? target.environment.id,
    targetType: 'service',
  };
}
