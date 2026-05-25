import { createInvalidDeployConfigError } from '../errors/api-business-error';
import { listEnvironmentResourceOutputVariableBindings } from '../queries/variables-resource-output.query';
import { listEnvironmentVariableValues } from '../queries/variables.query';
import type {
  EnvironmentResourceOutputVariableBindingRow,
  EnvironmentVariableValueRow,
} from '../queries/variables.query.types';
import type { ResolvedDescriptorService, ResolvedProjectContext } from './deployments.service.types';
import type {
  DescriptorServiceConnectionBindingInput,
  DescriptorServiceConnectionBindingPlan,
  DescriptorServiceConnectionBindingRemovalInput,
  PrepareDescriptorServiceConnectionBindingPlanInput,
} from './deployment-service-connections.service.types';

export interface DescriptorServiceConnectionContextRows {
  resourceOutputBindings: EnvironmentResourceOutputVariableBindingRow[];
  variableValues: EnvironmentVariableValueRow[];
}

interface DescriptorServiceConnectionKeyOwner {
  keyName: string;
  serviceName: string;
}

interface DescriptorServiceConnectionBindingTarget {
  environmentId: string;
  organizationId: string;
  service: ResolvedDescriptorService;
  targetServiceId: string;
}

export async function prepareDescriptorServiceConnectionBindingPlan(
  input: PrepareDescriptorServiceConnectionBindingPlanInput,
): Promise<DescriptorServiceConnectionBindingPlan> {
  const plan: DescriptorServiceConnectionBindingPlan = {
    actorPrincipalId: input.actorPrincipalId,
    removals: [],
    upserts: [],
  };

  for (const context of input.contexts) {
    const contextPlan: DescriptorServiceConnectionBindingPlan =
      await prepareDescriptorServiceConnectionBindingPlanForContext(input.actorPrincipalId, context);
    plan.removals.push(...contextPlan.removals);
    plan.upserts.push(...contextPlan.upserts);
  }

  return plan;
}

async function prepareDescriptorServiceConnectionBindingPlanForContext(
  actorPrincipalId: string,
  context: ResolvedProjectContext,
): Promise<DescriptorServiceConnectionBindingPlan> {
  const bindings: DescriptorServiceConnectionBindingInput[] = buildDescriptorServiceConnectionBindings(context);
  const rows: DescriptorServiceConnectionContextRows = await loadDescriptorServiceConnectionContextRows(
    context.environment.id,
  );

  return {
    actorPrincipalId,
    removals: buildStaleDescriptorServiceConnectionRemovals(context, bindings, rows.resourceOutputBindings),
    upserts: buildDescriptorServiceConnectionUpserts(bindings, rows),
  };
}

export async function loadDescriptorServiceConnectionContextRows(
  environmentId: string,
): Promise<DescriptorServiceConnectionContextRows> {
  const [variableValues, resourceOutputBindings]: [
    EnvironmentVariableValueRow[],
    EnvironmentResourceOutputVariableBindingRow[],
  ] = await Promise.all([
    listEnvironmentVariableValues(environmentId),
    listEnvironmentResourceOutputVariableBindings(environmentId),
  ]);

  return { resourceOutputBindings, variableValues };
}

function buildDescriptorServiceConnectionUpserts(
  bindings: readonly DescriptorServiceConnectionBindingInput[],
  rows: DescriptorServiceConnectionContextRows,
): DescriptorServiceConnectionBindingInput[] {
  const upserts: DescriptorServiceConnectionBindingInput[] = [];
  for (const binding of bindings) {
    assertDescriptorServiceConnectionBindingCanUpsert(binding, rows);
    const upsert: DescriptorServiceConnectionBindingInput | null = readDescriptorServiceConnectionUpsert(binding, rows);
    if (upsert !== null) {
      upserts.push(upsert);
    }
  }

  return upserts;
}

function buildDescriptorServiceConnectionBindings(
  context: ResolvedProjectContext,
): DescriptorServiceConnectionBindingInput[] {
  if (context.descriptorService === undefined) {
    return [];
  }

  return buildDescriptorServiceConnectionBindingsForTarget({
    environmentId: context.environment.id,
    organizationId: context.organization.id,
    service: context.descriptorService,
    targetServiceId: context.service.id,
  });
}

export function buildDescriptorServiceConnectionBindingsForTarget(
  target: DescriptorServiceConnectionBindingTarget,
): DescriptorServiceConnectionBindingInput[] {
  const bindings: DescriptorServiceConnectionBindingInput[] = [];
  for (const [resourceName, connection] of Object.entries(target.service.connections)) {
    for (const [keyName, outputName] of Object.entries(connection.env)) {
      bindings.push({
        environmentId: target.environmentId,
        keyName,
        organizationId: target.organizationId,
        outputName,
        resourceName,
        serviceName: target.service.name,
        targetServiceId: target.targetServiceId,
      });
    }
  }

  return bindings.sort(compareDescriptorServiceConnectionKeys);
}

export function assertDescriptorServiceConnectionBindingCanUpsert(
  binding: DescriptorServiceConnectionBindingInput,
  rows: DescriptorServiceConnectionContextRows,
): void {
  assertNoDirectServiceVariableConflict(binding, rows.variableValues);
  const existingBinding: EnvironmentResourceOutputVariableBindingRow | undefined = findExistingBinding(
    binding,
    rows.resourceOutputBindings,
  );
  if (existingBinding !== undefined) {
    assertExistingBindingCanBeManagedByDescriptor(binding, existingBinding);
  }
}

function assertNoDirectServiceVariableConflict(
  binding: DescriptorServiceConnectionBindingInput,
  variableValues: readonly EnvironmentVariableValueRow[],
): void {
  const conflict: EnvironmentVariableValueRow | undefined = variableValues.find(
    (variable: EnvironmentVariableValueRow): boolean =>
      variable.projectServiceId === binding.targetServiceId &&
      variable.targetResourceName === null &&
      variable.keyName === binding.keyName,
  );
  if (conflict !== undefined) {
    throw createInvalidDeployConfigError(
      `Descriptor connection for service "${binding.serviceName}" env "${binding.keyName}" conflicts with an existing direct service variable.`,
    );
  }
}

function readDescriptorServiceConnectionUpsert(
  binding: DescriptorServiceConnectionBindingInput,
  rows: DescriptorServiceConnectionContextRows,
): DescriptorServiceConnectionBindingInput | null {
  const existingBinding: EnvironmentResourceOutputVariableBindingRow | undefined = findExistingBinding(
    binding,
    rows.resourceOutputBindings,
  );
  if (existingBinding === undefined) {
    return binding;
  }

  if (existingBinding.source === 'descriptor' && resourceOutputBindingMatches(binding, existingBinding)) {
    return null;
  }

  return binding;
}

function findExistingBinding(
  binding: DescriptorServiceConnectionBindingInput,
  existingBindings: readonly EnvironmentResourceOutputVariableBindingRow[],
): EnvironmentResourceOutputVariableBindingRow | undefined {
  return existingBindings.find(
    (existingBinding: EnvironmentResourceOutputVariableBindingRow): boolean =>
      existingBinding.targetServiceName === binding.serviceName && existingBinding.keyName === binding.keyName,
  );
}

function assertExistingBindingCanBeManagedByDescriptor(
  binding: DescriptorServiceConnectionBindingInput,
  existingBinding: EnvironmentResourceOutputVariableBindingRow,
): void {
  if (existingBinding.source === 'descriptor' || resourceOutputBindingMatches(binding, existingBinding)) {
    return;
  }

  throw createInvalidDeployConfigError(
    `Descriptor connection for service "${binding.serviceName}" env "${binding.keyName}" conflicts with existing resource output binding "${existingBinding.resourceName}.${existingBinding.outputName}".`,
  );
}

function buildStaleDescriptorServiceConnectionRemovals(
  context: ResolvedProjectContext,
  bindings: readonly DescriptorServiceConnectionBindingInput[],
  existingBindings: readonly EnvironmentResourceOutputVariableBindingRow[],
): DescriptorServiceConnectionBindingRemovalInput[] {
  if (context.descriptorService === undefined) {
    return [];
  }

  const desiredKeyNames: Set<string> = new Set<string>(
    bindings.map((binding: DescriptorServiceConnectionBindingInput): string => binding.keyName),
  );
  const serviceName: string = context.descriptorService.name;

  return existingBindings
    .filter((existingBinding: EnvironmentResourceOutputVariableBindingRow): boolean =>
      isStaleDescriptorServiceConnection(serviceName, desiredKeyNames, existingBinding),
    )
    .map(
      (existingBinding: EnvironmentResourceOutputVariableBindingRow): DescriptorServiceConnectionBindingRemovalInput =>
        buildDescriptorServiceConnectionRemoval(context, existingBinding),
    )
    .sort(compareDescriptorServiceConnectionKeys);
}

function isStaleDescriptorServiceConnection(
  serviceName: string,
  desiredKeyNames: ReadonlySet<string>,
  existingBinding: EnvironmentResourceOutputVariableBindingRow,
): boolean {
  return (
    existingBinding.source === 'descriptor' &&
    existingBinding.targetServiceName === serviceName &&
    !desiredKeyNames.has(existingBinding.keyName)
  );
}

function buildDescriptorServiceConnectionRemoval(
  context: ResolvedProjectContext,
  existingBinding: EnvironmentResourceOutputVariableBindingRow,
): DescriptorServiceConnectionBindingRemovalInput {
  return {
    environmentId: existingBinding.environmentId,
    keyName: existingBinding.keyName,
    organizationId: context.organization.id,
    serviceName: existingBinding.targetServiceName,
    targetServiceId: context.service.id,
  };
}

function resourceOutputBindingMatches(
  binding: DescriptorServiceConnectionBindingInput,
  existingBinding: EnvironmentResourceOutputVariableBindingRow,
): boolean {
  return existingBinding.resourceName === binding.resourceName && existingBinding.outputName === binding.outputName;
}

function compareDescriptorServiceConnectionKeys(
  left: DescriptorServiceConnectionKeyOwner,
  right: DescriptorServiceConnectionKeyOwner,
): number {
  const serviceNameOrder: number = left.serviceName.localeCompare(right.serviceName);
  if (serviceNameOrder !== 0) {
    return serviceNameOrder;
  }

  return left.keyName.localeCompare(right.keyName);
}
