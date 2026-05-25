import { basename } from 'node:path';
import type { SafeParseReturnType } from 'zod';
import {
  defaultCompartmentEnvironmentName,
  type ImportVariablesResponse,
  type RemoveVariableResponse,
  type VariableListResponse,
  type VariableLocalRunItem,
  type VariableLocalRunRequest,
  type VariableLocalRunResponse,
  type VariableResponse,
  variableLocalRunCommandNameSchema,
} from '@compartment/contracts';
import {
  getVariable as getVariableApi,
  importVariables as importVariablesApi,
  loadVariablesForLocalRun as loadVariablesForLocalRunApi,
  listVariables as listVariablesApi,
  removeVariable as removeVariableApi,
  setVariable as setVariableApi,
  type CompartmentRequester,
} from '@compartment/sdk';
import type { CliIo } from '../app.types';
import { readNonCompartmentEnvironment } from '../command-environment';
import type { CommandResult } from '../command-runner.types';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';
import { resolveProjectTarget } from './project-target.service';
import type { ResolvedProjectTarget } from './projects.service.types';
import { runVariableChildCommand } from './variable-run-child-process.service';
import type {
  ImportVariablesInput,
  RemoveVariableInput,
  ResolvedVariableReadTarget,
  ResolvedVariableWriteTarget,
  RunVariableCommandInput,
  SetVariableInput,
  ShowVariableInput,
  VariableScopeInput,
} from './variables.service.types';

const localRunDefaultEnvironmentName: string = 'development';

interface ResolvedVariableRunTarget extends ResolvedVariableWriteTarget {
  environmentName: string;
}

export async function listVariables(
  context: AuthenticatedContext,
  input: VariableScopeInput,
): Promise<VariableListResponse> {
  const request: CompartmentRequester = createVariableRequester(context);
  const target: ResolvedVariableReadTarget = await resolveVariableTarget(input);

  return await listVariablesApi(request, target);
}

export async function showVariable(context: AuthenticatedContext, input: ShowVariableInput): Promise<VariableResponse> {
  const request: CompartmentRequester = createVariableRequester(context);
  const target: ResolvedVariableReadTarget = await resolveVariableTarget(input);

  return await getVariableApi(request, input.keyName, target);
}

export async function setVariable(context: AuthenticatedContext, input: SetVariableInput): Promise<VariableResponse> {
  const request: CompartmentRequester = createVariableRequester(context);
  const target: ResolvedVariableWriteTarget = await resolveVariableTarget(input);

  return await setVariableApi(request, {
    environmentName: target.environmentName,
    ...(input.fromResource !== undefined ? { fromResource: input.fromResource } : {}),
    keyName: input.keyName,
    projectName: target.projectName,
    ...(target.resourceName !== undefined ? { resourceName: target.resourceName } : {}),
    ...(input.sensitivity !== undefined ? { sensitivity: input.sensitivity } : {}),
    ...(target.serviceName !== undefined ? { serviceName: target.serviceName } : {}),
    ...(input.value !== undefined ? { value: input.value } : {}),
  });
}

export async function importVariables(
  context: AuthenticatedContext,
  input: ImportVariablesInput,
): Promise<ImportVariablesResponse> {
  const request: CompartmentRequester = createVariableRequester(context);
  const target: ResolvedVariableWriteTarget = await resolveVariableTarget(input);

  return await importVariablesApi(request, {
    entries: input.entries,
    environmentName: target.environmentName,
    projectName: target.projectName,
    ...(input.replace !== undefined ? { replace: input.replace } : {}),
    ...(target.resourceName !== undefined ? { resourceName: target.resourceName } : {}),
    ...(input.sensitivity !== undefined ? { sensitivity: input.sensitivity } : {}),
    ...(target.serviceName !== undefined ? { serviceName: target.serviceName } : {}),
  });
}

export async function removeVariable(
  context: AuthenticatedContext,
  input: RemoveVariableInput,
): Promise<RemoveVariableResponse> {
  const request: CompartmentRequester = createVariableRequester(context);
  const target: ResolvedVariableReadTarget = await resolveVariableTarget(input);

  return await removeVariableApi(request, input.keyName, target);
}

export async function runVariableCommand(
  context: AuthenticatedContext,
  input: RunVariableCommandInput,
  io: CliIo,
): Promise<CommandResult> {
  const request: CompartmentRequester = createVariableRequester(context);
  const target: ResolvedVariableRunTarget = await resolveVariableRunTarget(input);
  assertProductionVariableRunAllowed(input, target);
  const response: VariableLocalRunResponse = await loadVariablesForLocalRunApi(
    request,
    buildVariableLocalRunRequest(input, target),
  );
  if (response.variables.length === 0) {
    io.stderr('No compartment variables were injected for the selected variable scope.\n');
  }

  const childEnv: NodeJS.ProcessEnv = buildVariableRunEnvironment(process.env, response.variables);
  try {
    return await runVariableChildCommand(input.childCommand, childEnv);
  } finally {
    clearVariableRunEnvironment(childEnv);
    clearVariableLocalRunValues(response.variables);
  }
}

function createVariableRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}

async function resolveVariableRunTarget(input: RunVariableCommandInput): Promise<ResolvedVariableRunTarget> {
  const target: ResolvedVariableWriteTarget = await resolveVariableTarget(input);

  return {
    environmentName: input.environmentName ?? localRunDefaultEnvironmentName,
    projectName: target.projectName,
    ...(target.resourceName !== undefined ? { resourceName: target.resourceName } : {}),
    ...(target.serviceName !== undefined ? { serviceName: target.serviceName } : {}),
  };
}

async function resolveVariableTarget(input: VariableScopeInput): Promise<ResolvedVariableWriteTarget> {
  const projectTarget: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  return {
    environmentName: input.environmentName,
    projectName: projectTarget.projectName,
    ...(input.resourceName !== undefined ? { resourceName: input.resourceName } : {}),
    ...(input.serviceName !== undefined ? { serviceName: input.serviceName } : {}),
  };
}

function assertProductionVariableRunAllowed(input: RunVariableCommandInput, target: ResolvedVariableRunTarget): void {
  if (!isProductionVariableRun(target)) {
    return;
  }
  if (!input.allowProduction) {
    throw new Error('Pass --allow-production to run a local command with production variables.');
  }
}

function buildVariableLocalRunRequest(
  input: RunVariableCommandInput,
  target: ResolvedVariableRunTarget,
): VariableLocalRunRequest {
  return {
    commandName: readVariableRunCommandName(input.childCommand),
    environmentName: target.environmentName,
    productionAck: isProductionVariableRun(target),
    projectName: target.projectName,
    resourceName: target.resourceName ?? null,
    serviceName: target.serviceName ?? null,
  };
}

function isProductionVariableRun(target: ResolvedVariableRunTarget): boolean {
  return target.environmentName === defaultCompartmentEnvironmentName;
}

function readVariableRunCommandName(command: readonly string[]): string | null {
  const executable: string | undefined = command[0];
  if (executable === undefined) {
    return null;
  }

  const commandName: string = basename(executable).trim();
  const result: SafeParseReturnType<string, string> = variableLocalRunCommandNameSchema.safeParse(commandName);
  return result.success ? result.data : null;
}

function buildVariableRunEnvironment(
  parentEnv: NodeJS.ProcessEnv,
  variables: readonly VariableLocalRunItem[],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = readNonCompartmentEnvironment(parentEnv);

  for (const variable of variables) {
    env[variable.keyName] = variable.value;
  }

  return env;
}

function clearVariableRunEnvironment(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    delete env[key];
  }
}

function clearVariableLocalRunValues(variables: VariableLocalRunItem[]): void {
  for (const variable of variables) {
    variable.value = '';
  }
}
