import { z } from 'zod';
import { resolveCompartmentServiceKind, type CompartmentServiceKind } from './compartment-service-kind.contract';
import type { CompartmentAuthoredServiceConfig } from './compartment-descriptor.types';
import type { CompartmentServiceBuildStrategy, ResolvedCompartmentServiceBuildPacker } from './service-build.contract';
import type { ContractSchema } from './schema.types';

export const staticCompartmentServiceKind: CompartmentServiceKind = 'static';
export const staticCompartmentServiceOutputDirectoryRule: string =
  'build.outputDirectory must be a relative path inside the service directory and must not resolve to the service root.';
const absoluteStaticOutputDirectoryPattern: RegExp = /^(?:[A-Za-z]:|[/\\]{1,2})/u;

export const compartmentServiceBuildOutputDirectorySchema: ContractSchema<string> = z
  .string()
  .min(1)
  .refine(isValidStaticOutputDirectoryPath, staticCompartmentServiceOutputDirectoryRule);

export function validateStaticCompartmentServiceConfig(
  service: CompartmentAuthoredServiceConfig,
  context: z.RefinementCtx,
): void {
  const kind: CompartmentServiceKind = resolveCompartmentServiceKind(service.kind);
  if (isStaticCompartmentServiceKind(kind)) {
    validateStaticServiceConfig(service, context);
    return;
  }

  if (service.build?.outputDirectory !== undefined) {
    addValidationIssue(
      context,
      ['build', 'outputDirectory'],
      'build.outputDirectory is only supported for kind: static services.',
    );
  }
}

export function isStaticCompartmentServiceKind(kind: CompartmentServiceKind): boolean {
  return kind === staticCompartmentServiceKind;
}

export function resolveStaticCompartmentServiceBuildPacker(
  strategy: CompartmentServiceBuildStrategy,
  servicePath: string,
): ResolvedCompartmentServiceBuildPacker {
  if (strategy !== 'auto') {
    throw new Error(
      `Static services do not support build.strategy. Service "${servicePath}" must omit build.strategy.`,
    );
  }

  return 'static';
}

function validateStaticServiceConfig(service: CompartmentAuthoredServiceConfig, context: z.RefinementCtx): void {
  if (service.build?.outputDirectory === undefined) {
    addValidationIssue(context, ['build', 'outputDirectory'], 'kind: static requires build.outputDirectory.');
  }
  if (service.build?.strategy !== undefined) {
    addValidationIssue(context, ['build', 'strategy'], 'kind: static does not support build.strategy.');
  }
  if (service.run !== undefined) {
    addValidationIssue(context, ['run'], 'kind: static does not support run.');
  }
  if (service.readiness !== undefined) {
    addValidationIssue(context, ['readiness'], 'kind: static does not support readiness.');
  }
  if (service.release !== undefined) {
    addValidationIssue(context, ['release'], 'kind: static does not support release.');
  }
}

function addValidationIssue(context: z.RefinementCtx, path: (string | number)[], message: string): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
  });
}

function isValidStaticOutputDirectoryPath(relativePath: string): boolean {
  if (absoluteStaticOutputDirectoryPattern.test(relativePath)) {
    return false;
  }

  return resolveStaticOutputDirectorySegments(relativePath).length > 0;
}

function resolveStaticOutputDirectorySegments(relativePath: string): string[] {
  const normalizedSegments: string[] = [];
  for (const rawSegment of relativePath.replaceAll('\\', '/').split('/')) {
    if (rawSegment === '' || rawSegment === '.') {
      continue;
    }
    if (rawSegment === '..') {
      if (normalizedSegments.length === 0) {
        return [];
      }
      normalizedSegments.pop();
      continue;
    }

    normalizedSegments.push(rawSegment);
  }

  return normalizedSegments;
}
