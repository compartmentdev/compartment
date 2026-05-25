import {
  parseResourceOutputReference,
  type CompartmentAuthoredResourceConfig,
  type ResourceOutputReference,
} from '@compartment/contracts';
import type { VariableGroupBindingInput } from '../../services/variable-groups.service.types';
import type { VariableScopeInput } from '../../services/variables.service.types';
import { findStoredProjectDescriptor } from '../../services/project-descriptor.service';
import type { StoredProjectDescriptor } from '../../services/project-descriptor.types';
import type { VariableCommandOptions } from '../command.types';

export async function createVariableGroupBindingInput(
  options: VariableCommandOptions,
  variableGroupName: string,
  requireDeclaredResourceTarget: boolean = true,
): Promise<VariableGroupBindingInput> {
  const scopeInput: VariableScopeInput = requireDeclaredResourceTarget
    ? await createMutatingVariableScopeInput(options)
    : createVariableScopeInput(options);

  return {
    ...scopeInput,
    variableGroupName,
  };
}

export async function createMutatingVariableScopeInput(options: VariableCommandOptions): Promise<VariableScopeInput> {
  const input: VariableScopeInput = createVariableScopeInput(options);
  await assertDeclaredResourceTarget(input);

  return input;
}

export function createVariableScopeInput(options: VariableCommandOptions): VariableScopeInput {
  assertVariableTargetOptions(options);

  return {
    cwd: process.cwd(),
    environmentName: options.env,
    projectName: options.project,
    resourceName: options.resource,
    serviceName: options.service,
  };
}

export function buildVariableTargetLabel(
  projectName: string,
  environmentName: string,
  resourceName: string | null,
  serviceName: string | null,
): string {
  if (resourceName !== null) {
    return `${projectName} / ${environmentName} / resource ${resourceName}`;
  }

  return serviceName === null
    ? `${projectName} / ${environmentName}`
    : `${projectName} / ${environmentName} / ${serviceName}`;
}

export async function assertDeclaredResourceOutputBinding(
  input: VariableScopeInput,
  fromResource: string,
  serviceName: string,
): Promise<void> {
  const descriptor: StoredProjectDescriptor = await requireStoredProjectDescriptor(input.cwd, fromResource);
  assertResourceOutputProjectMatches(input, fromResource, descriptor);
  assertResourceOutputServiceDeclared(serviceName, descriptor);
  const { outputName, resourceName }: ResourceOutputReference = readResourceOutputReference(fromResource);
  assertDeclaredResourceOutputTarget(descriptor, resourceName, outputName);
}

function readResourceOutputReference(fromResource: string): ResourceOutputReference {
  const reference: ResourceOutputReference | null = parseResourceOutputReference(fromResource);
  if (reference === null) {
    throw new Error('--from-resource must use resource.output.');
  }

  return reference;
}

function assertDeclaredResourceOutputTarget(
  descriptor: StoredProjectDescriptor,
  resourceName: string,
  outputName: string,
): void {
  const resource: CompartmentAuthoredResourceConfig | undefined = descriptor.descriptor.resources?.[resourceName];
  if (resource === undefined) {
    throw new Error(
      `Resource "${resourceName}" is not declared in local compartment.yml under resources.${resourceName}.`,
    );
  }
  assertDeclaredResourceOutput(resource, resourceName, outputName);
}

function assertResourceOutputProjectMatches(
  input: VariableScopeInput,
  fromResource: string,
  descriptor: StoredProjectDescriptor,
): void {
  if (input.projectName === undefined || descriptor.descriptor.name === input.projectName) {
    return;
  }

  throw new Error(
    `--from-resource ${fromResource} with --project ${input.projectName} requires local compartment.yml for project ${input.projectName}, but found project ${descriptor.descriptor.name}.`,
  );
}

function assertResourceOutputServiceDeclared(serviceName: string, descriptor: StoredProjectDescriptor): void {
  if (Object.hasOwn(descriptor.descriptor.services, serviceName)) {
    return;
  }

  throw new Error(`Service "${serviceName}" is not declared in local compartment.yml under services.${serviceName}.`);
}

function assertDeclaredResourceOutput(
  resource: CompartmentAuthoredResourceConfig,
  resourceName: string,
  outputName: string,
): void {
  if (Object.hasOwn(resource.outputs ?? {}, outputName)) {
    return;
  }

  throw new Error(
    `Output "${outputName}" is not declared in local compartment.yml under resources.${resourceName}.outputs.${outputName}.`,
  );
}

function assertVariableTargetOptions(options: VariableCommandOptions): void {
  if (options.resource !== undefined && options.service !== undefined) {
    throw new Error('Pass either --service or --resource, not both.');
  }
}

async function assertDeclaredResourceTarget(input: VariableScopeInput): Promise<void> {
  const { cwd, projectName, resourceName } = input;
  if (resourceName === undefined) {
    return;
  }

  const descriptor: StoredProjectDescriptor = await requireStoredProjectDescriptor(cwd, `--resource ${resourceName}`);

  if (projectName !== undefined && descriptor.descriptor.name !== projectName) {
    throw new Error(
      `--resource ${resourceName} with --project ${projectName} requires local compartment.yml for project ${projectName}, but found project ${descriptor.descriptor.name}.`,
    );
  }

  if (!Object.hasOwn(descriptor.descriptor.resources ?? {}, resourceName)) {
    throw new Error(
      `Resource "${resourceName}" is not declared in local compartment.yml under resources.${resourceName}.`,
    );
  }
}

async function requireStoredProjectDescriptor(cwd: string, targetLabel: string): Promise<StoredProjectDescriptor> {
  const descriptor: StoredProjectDescriptor | undefined = await findStoredProjectDescriptor(cwd);
  if (descriptor === undefined) {
    throw new Error(`${targetLabel} requires a local compartment.yml descriptor.`);
  }

  return descriptor;
}
