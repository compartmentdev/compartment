import { z } from 'zod';
import type {
  CompartmentAuthoredDescriptor,
  CompartmentAuthoredResourceConfig,
  CompartmentAuthoredResources,
  CompartmentAuthoredService,
  CompartmentAuthoredServiceConfig,
  CompartmentResourceOutputConfig,
  CompartmentServiceConnectionConfig,
  CompartmentServiceConnections,
} from './compartment-descriptor.types';
import { compartmentResourceOutputNameSchema } from './compartment-resource.contract';
import type { ContractSchema } from './schema.types';
import { variableKeyNameSchema } from './variable-key.contract';

interface CompartmentServiceConnectionServiceConfig extends CompartmentAuthoredServiceConfig {
  connections: CompartmentServiceConnections;
}

export const compartmentServiceConnectionShapeRule: string = 'connections.<resource>.env.<KEY>: <resource-output-name>';
export const compartmentServiceConnectionValidationRules: readonly string[] = [
  'connections and each connection env map must not be empty',
  'connection resource names must reference declared resources',
  'connection output names must reference declared or preset resource outputs',
  'connection env keys must be unique across all connections for one service',
];

const compartmentServiceConnectionConfigSchema: ContractSchema<CompartmentServiceConnectionConfig> = z
  .object({
    env: z.record(variableKeyNameSchema, compartmentResourceOutputNameSchema).refine(hasConnectionEnvEntries, {
      message: 'Service connection env must not be empty.',
    }),
  })
  .strict();

export function createCompartmentServiceConnectionsSchema(
  resourceNameSchema: ContractSchema<string>,
): ContractSchema<CompartmentServiceConnections> {
  return z.record(resourceNameSchema, compartmentServiceConnectionConfigSchema).refine(hasServiceConnectionsEntries, {
    message: 'Service connections must not be empty.',
  });
}

export function validateDescriptorServiceConnections(
  descriptor: CompartmentAuthoredDescriptor,
  context: z.RefinementCtx,
): void {
  const resources: CompartmentAuthoredResources = descriptor.resources ?? {};

  for (const [serviceName, service] of Object.entries(descriptor.services)) {
    if (!isServiceConnectionConfig(service)) {
      continue;
    }

    validateServiceConnectionResources(serviceName, service.connections, resources, context);
    validateServiceConnectionEnvKeys(serviceName, service.connections, context);
  }
}

function validateServiceConnectionResources(
  serviceName: string,
  connections: CompartmentServiceConnections,
  resources: CompartmentAuthoredResources,
  context: z.RefinementCtx,
): void {
  for (const [resourceName, connection] of Object.entries(connections)) {
    validateServiceConnectionResource(serviceName, resourceName, connection, resources, context);
  }
}

function validateServiceConnectionResource(
  serviceName: string,
  resourceName: string,
  connection: CompartmentServiceConnectionConfig,
  resources: CompartmentAuthoredResources,
  context: z.RefinementCtx,
): void {
  const resourceOutputs: Record<string, CompartmentResourceOutputConfig> | null = readResourceOutputs(
    serviceName,
    resourceName,
    resources,
    context,
  );
  if (resourceOutputs === null) {
    return;
  }

  validateServiceConnectionResourceOutputs(serviceName, resourceName, connection, resourceOutputs, context);
}

function readResourceOutputs(
  serviceName: string,
  resourceName: string,
  resources: CompartmentAuthoredResources,
  context: z.RefinementCtx,
): Record<string, CompartmentResourceOutputConfig> | null {
  const resource: CompartmentAuthoredResourceConfig | undefined = resources[resourceName];
  if (resource !== undefined) {
    return resource.outputs ?? {};
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Service "${serviceName}" connection references unknown resource "${resourceName}".`,
    path: ['services', serviceName, 'connections', resourceName],
  });
  return null;
}

function validateServiceConnectionResourceOutputs(
  serviceName: string,
  resourceName: string,
  connection: CompartmentServiceConnectionConfig,
  resourceOutputs: Record<string, CompartmentResourceOutputConfig>,
  context: z.RefinementCtx,
): void {
  for (const [keyName, outputName] of Object.entries(connection.env)) {
    if (resourceOutputs[outputName] !== undefined) {
      continue;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Service "${serviceName}" connection env "${keyName}" references unknown resource output "${resourceName}.${outputName}".`,
      path: ['services', serviceName, 'connections', resourceName, 'env', keyName],
    });
  }
}

function validateServiceConnectionEnvKeys(
  serviceName: string,
  connections: CompartmentServiceConnections,
  context: z.RefinementCtx,
): void {
  const seenKeyResourceNames: Map<string, string> = new Map<string, string>();

  for (const [resourceName, connection] of Object.entries(connections)) {
    validateServiceConnectionEnvKeySet(serviceName, resourceName, connection, seenKeyResourceNames, context);
  }
}

function validateServiceConnectionEnvKeySet(
  serviceName: string,
  resourceName: string,
  connection: CompartmentServiceConnectionConfig,
  seenKeyResourceNames: Map<string, string>,
  context: z.RefinementCtx,
): void {
  for (const keyName of Object.keys(connection.env)) {
    const previousResourceName: string | undefined = seenKeyResourceNames.get(keyName);
    if (previousResourceName === undefined) {
      seenKeyResourceNames.set(keyName, resourceName);
      continue;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Service "${serviceName}" connection env "${keyName}" is declared by both "${previousResourceName}" and "${resourceName}".`,
      path: ['services', serviceName, 'connections', resourceName, 'env', keyName],
    });
  }
}

function isServiceConnectionConfig(
  service: CompartmentAuthoredService,
): service is CompartmentServiceConnectionServiceConfig {
  return typeof service !== 'string' && service.connections !== undefined;
}

function hasConnectionEnvEntries(record: Record<string, string>): boolean {
  return Object.keys(record).length > 0;
}

function hasServiceConnectionsEntries(record: CompartmentServiceConnections): boolean {
  return Object.keys(record).length > 0;
}
