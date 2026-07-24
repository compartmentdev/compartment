import { z } from 'zod';
import { appRouteAccessModeSchema } from './access.contract';
import {
  readContractShapeFieldNames,
  readRequiredContractShapeFieldNames,
  type ContractObjectShape,
} from './contract-shape';
import type {
  CompartmentAuthoredDescriptor,
  CompartmentAuthoredDescriptorInput,
  CompartmentAuthoredService,
  CompartmentAuthoredServiceConfig,
  CompartmentDescriptorServiceValueForm,
  CompartmentInitResult,
  CompartmentInitResultInput,
  CompartmentServiceConnections,
} from './compartment-descriptor.types';
import { compartmentAuthoredResourceConfigSchema } from './compartment-resource.contract';
import {
  createCompartmentServiceConnectionsSchema,
  validateDescriptorServiceConnections,
} from './compartment-service-connections.contract';
import { compartmentServiceKindSchema } from './compartment-service-kind.contract';
import { compartmentServiceBuildConfigSchema } from './service-build.contract';
import { compartmentServiceReadinessConfigSchema } from './service-readiness.contract';
import { compartmentServiceReleaseConfigSchema } from './service-release.contract';
import { compartmentServiceRunConfigSchema } from './service-run.contract';
import { validateStaticCompartmentServiceConfig } from './service-static.contract';
import type { ContractSchema } from './schema.types';

export const defaultApplicationPorts: number[] = [3_000];

export {
  compartmentServiceKindSchema,
  isDeployableCompartmentServiceKind,
  isRoutableCompartmentServiceKind,
  resolveCompartmentServiceKind,
  type CompartmentServiceKind,
} from './compartment-service-kind.contract';
export type {
  CompartmentAuthoredDescriptor,
  CompartmentAuthoredDescriptorInput,
  CompartmentAuthoredResourceConfig,
  CompartmentResourceOutputConfig,
  CompartmentResourceOutputs,
  CompartmentResourceReadinessConfig,
  CompartmentResourceVolumes,
  CompartmentResourceVolumeValue,
  CompartmentAuthoredService,
  CompartmentAuthoredServiceConfig,
  CompartmentServiceConnections,
  CompartmentInitResult,
} from './compartment-descriptor.types';
export type { CompartmentDescriptorRelatedFile } from './compartment-descriptor-guide.contract';

export const compartmentProjectNamePatternText: string = '^[a-z][a-z0-9-]{0,62}$';
export const compartmentServiceNamePatternText: string = '^[a-z0-9][a-z0-9_-]{0,62}$';
const compartmentProjectNamePattern: RegExp = new RegExp(compartmentProjectNamePatternText, 'u');
const compartmentServiceNamePattern: RegExp = new RegExp(compartmentServiceNamePatternText, 'u');
export const compartmentReservedProjectNames: readonly string[] = ['create'];
const reservedCompartmentProjectNames: ReadonlySet<string> = new Set(compartmentReservedProjectNames);
export const compartmentDescriptorServiceValueFormValues: readonly [
  CompartmentDescriptorServiceValueForm,
  CompartmentDescriptorServiceValueForm,
] = ['string_path', 'service_config'];
export const compartmentProjectNameSchema: ContractSchema<string> = z
  .string()
  .regex(compartmentProjectNamePattern)
  .refine(
    (projectName: string): boolean => !reservedCompartmentProjectNames.has(projectName),
    'Project name "create" is reserved.',
  );
const compartmentPathSchema: z.ZodString = z.string().min(1);
export const compartmentServiceNameSchema: ContractSchema<string> = z.string().regex(compartmentServiceNamePattern);
export const compartmentResourceNameSchema: ContractSchema<string> = z.string().regex(compartmentServiceNamePattern);

type DescriptorYamlScalar = boolean | number | string;
type DescriptorYamlValue = DescriptorYamlScalar | object;
type DescriptorYamlRecord = Record<string, DescriptorYamlValue | undefined>;

const compartmentServiceConnectionsSchema: ContractSchema<CompartmentServiceConnections> =
  createCompartmentServiceConnectionsSchema(compartmentResourceNameSchema);
const compartmentAuthoredServiceConfigShape: ContractObjectShape = createCompartmentAuthoredServiceConfigShape();
export const compartmentDescriptorServiceConfigFieldNames: string[] = readContractShapeFieldNames(
  compartmentAuthoredServiceConfigShape,
);
export const compartmentDescriptorRequiredServiceConfigFieldNames: string[] = readRequiredContractShapeFieldNames(
  compartmentAuthoredServiceConfigShape,
);
const compartmentAuthoredServiceConfigSchema: ContractSchema<CompartmentAuthoredServiceConfig> = z
  .object(createCompartmentAuthoredServiceConfigShape())
  .strict()
  .superRefine((service: CompartmentAuthoredServiceConfig, context: z.RefinementCtx): void => {
    if (service.ports !== undefined && new Set(service.ports).size !== service.ports.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Service ports must be unique.',
        path: ['ports'],
      });
    }
    if (service.build?.strategy === 'dockerfile' && service.run?.command !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'run.command is only supported when the service build resolves to Railpack.',
        path: ['run', 'command'],
      });
    }

    validateStaticCompartmentServiceConfig(service, context);
  });
const compartmentAuthoredServiceSchema: ContractSchema<CompartmentAuthoredService> = z.union([
  compartmentPathSchema,
  compartmentAuthoredServiceConfigSchema,
]);
export const compartmentAuthoredDescriptorSchema: ContractSchema<
  CompartmentAuthoredDescriptor,
  CompartmentAuthoredDescriptorInput
> = z
  .object({
    name: compartmentProjectNameSchema,
    resources: z.record(compartmentResourceNameSchema, compartmentAuthoredResourceConfigSchema).optional(),
    services: z.record(compartmentServiceNameSchema, compartmentAuthoredServiceSchema),
  })
  .strict()
  .refine((descriptor: CompartmentAuthoredDescriptor): boolean => Object.keys(descriptor.services).length > 0, {
    message: 'At least one service is required.',
    path: ['services'],
  })
  .superRefine(validateDescriptorServiceConnections)
  .superRefine((descriptor: CompartmentAuthoredDescriptor, context: z.RefinementCtx): void => {
    for (const resourceName of Object.keys(descriptor.resources ?? {})) {
      if (descriptor.services[resourceName] !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Resource name ${resourceName} must not collide with a service name.`,
          path: ['resources', resourceName],
        });
      }
    }
  });
export const compartmentInitResultSchema: ContractSchema<CompartmentInitResult, CompartmentInitResultInput> = z
  .object({
    descriptor: compartmentAuthoredDescriptorSchema,
    file: z.string().min(1),
  })
  .strict();

export function buildDefaultCompartmentAuthoredDescriptor(
  name: string,
  servicePath: string = '.',
): CompartmentAuthoredDescriptor {
  const parsedDescriptor: z.SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
    compartmentAuthoredDescriptorSchema.safeParse({
      name,
      services: {
        web: servicePath,
      },
    });
  if (!parsedDescriptor.success) {
    throw new Error(
      `Project name "${name}" is invalid. Use a slug starting with a letter and no longer than 63 characters.`,
    );
  }

  return parsedDescriptor.data;
}

export function formatCompartmentAuthoredDescriptor(descriptor: CompartmentAuthoredDescriptor): string {
  const resourcesSection: string =
    descriptor.resources === undefined
      ? ''
      : `
resources:
${formatYamlRecord(descriptor.resources, 2)}
`;
  return `name: ${formatYamlScalar(descriptor.name)}
${resourcesSection}
services:
${formatYamlRecord(descriptor.services, 2)}
`;
}

function createCompartmentAuthoredServiceConfigShape(): {
  accessMode: z.ZodOptional<typeof appRouteAccessModeSchema>;
  build: z.ZodOptional<typeof compartmentServiceBuildConfigSchema>;
  connections: z.ZodOptional<typeof compartmentServiceConnectionsSchema>;
  kind: z.ZodOptional<typeof compartmentServiceKindSchema>;
  path: typeof compartmentPathSchema;
  ports: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
  readiness: z.ZodOptional<typeof compartmentServiceReadinessConfigSchema>;
  release: z.ZodOptional<typeof compartmentServiceReleaseConfigSchema>;
  run: z.ZodOptional<typeof compartmentServiceRunConfigSchema>;
} {
  return {
    accessMode: appRouteAccessModeSchema.optional(),
    build: compartmentServiceBuildConfigSchema.optional(),
    connections: compartmentServiceConnectionsSchema.optional(),
    path: compartmentPathSchema,
    kind: compartmentServiceKindSchema.optional(),
    ports: z.array(z.number().int().min(1).max(65_535)).min(1).optional(),
    run: compartmentServiceRunConfigSchema.optional(),
    release: compartmentServiceReleaseConfigSchema.optional(),
    readiness: compartmentServiceReadinessConfigSchema.optional(),
  };
}

function formatYamlRecord(record: DescriptorYamlRecord, indent: number = 0): string {
  return Object.entries(record)
    .flatMap(([key, value]: [string, DescriptorYamlValue | undefined]): string[] => formatYamlEntry(key, value, indent))
    .join('\n');
}

function formatYamlEntry(key: string, value: DescriptorYamlValue | undefined, indent: number): string[] {
  if (value === undefined) {
    return [];
  }
  return [`${' '.repeat(indent)}${formatYamlKey(key)}: ${formatYamlValue(value)}`];
}

function formatYamlKey(key: string): string {
  return isPlainYamlToken(key) ? key : JSON.stringify(key);
}

function formatYamlValue(value: DescriptorYamlValue): string {
  if (!isYamlScalar(value)) {
    return JSON.stringify(value);
  }
  return formatYamlScalar(value);
}

function isYamlScalar(value: DescriptorYamlValue): value is DescriptorYamlScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function formatYamlScalar(value: DescriptorYamlScalar): string {
  if (typeof value !== 'string') {
    return String(value);
  }
  return isPlainYamlToken(value) && !isReservedYamlScalar(value) ? value : JSON.stringify(value);
}

function isPlainYamlToken(value: string): boolean {
  return /^[A-Za-z0-9_./@:-]+$/u.test(value);
}

function isReservedYamlScalar(value: string): boolean {
  return ['false', 'null', 'true'].includes(value.toLowerCase()) || /^[-+]?\d+(?:\.\d+)?$/u.test(value);
}
