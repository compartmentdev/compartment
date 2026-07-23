import { z } from 'zod';
import type {
  CompartmentAuthoredResourceConfig,
  CompartmentAuthoredResourceConfigInput,
  CompartmentAuthoredResourceFullConfigInput,
  CompartmentAuthoredResourcePresetConfigInput,
  CompartmentResourceEnv,
  CompartmentResourceGeneratedVariableConfig,
  CompartmentResourceGeneratedVariables,
  CompartmentResourceOperationsConfig,
  CompartmentResourceOutputs,
  CompartmentResourcePreset,
  CompartmentResourceReadinessConfig,
  CompartmentResourceVolumes,
} from './compartment-descriptor.types';
import { isSerializedNormalizedPresetResource } from './compartment-resource-preset-equality.contract';

export const compartmentResourcePresetValues: readonly [CompartmentResourcePreset] = ['postgres'];
export const compartmentResourcePresetOverrideFieldNames: readonly ['env'] = ['env'];
const postgresPresetPasswordEnvName: string = ['POSTGRES', 'PASSWORD'].join('_');

const postgresPresetBackupCommand: string = `PGPASSWORD="$${postgresPresetPasswordEnvName}" pg_dump --host "$COMPARTMENT_RESOURCE_HOST" --username "$POSTGRES_USER" "$POSTGRES_DB" > "$COMPARTMENT_BACKUP_DIR/postgres.sql"`;
const postgresPresetRestoreCommand: string = `PGPASSWORD="$${postgresPresetPasswordEnvName}" psql --host "$COMPARTMENT_RESOURCE_HOST" --username "$POSTGRES_USER" "$POSTGRES_DB" < "$COMPARTMENT_BACKUP_DIR/postgres.sql"`;

const postgresResourcePreset: CompartmentAuthoredResourceConfig = {
  env: {
    POSTGRES_DB: 'app',
    POSTGRES_USER: 'app',
  },
  generatedVariables: {
    [postgresPresetPasswordEnvName]: {
      generator: 'token',
    },
  },
  // Pinned from postgres:16-alpine on 2026-07-23; refresh the digest intentionally with the readable tag.
  image: 'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
  operations: {
    backup: {
      command: postgresPresetBackupCommand,
      schedule: {
        interval: 'daily',
        retention: {
          maxAgeDays: 7,
        },
      },
    },
    restore: {
      command: postgresPresetRestoreCommand,
    },
  },
  outputs: {
    database: {
      sensitive: false,
      value: '${env.POSTGRES_DB}',
    },
    host: {
      sensitive: false,
      value: '${resource.host}',
    },
    port: {
      sensitive: false,
      value: '5432',
    },
    'connection-url': {
      sensitive: true,
      value: 'postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${resource.host}:5432/${env.POSTGRES_DB}',
    },
  },
  ports: [5432],
  readiness: {
    port: 5432,
    timeoutMs: 60_000,
    type: 'tcp',
  },
  volumes: {
    data: '/var/lib/postgresql/data',
  },
};

const compartmentResourcePresets: Record<CompartmentResourcePreset, CompartmentAuthoredResourceConfig> = {
  postgres: postgresResourcePreset,
};
export interface CompartmentAuthoredResourceConfigRawInput {
  command?: string[] | undefined;
  env?: CompartmentResourceEnv | undefined;
  generatedVariables?: CompartmentResourceGeneratedVariables | undefined;
  image?: string | undefined;
  operations?: CompartmentResourceOperationsConfig | undefined;
  outputs?: CompartmentResourceOutputs | undefined;
  ports?: number[] | undefined;
  preset?: CompartmentResourcePreset | undefined;
  readiness?: CompartmentResourceReadinessConfig | undefined;
  volumes?: CompartmentResourceVolumes | undefined;
}

const compartmentResourcePresetUnsupportedFieldNames: readonly (keyof CompartmentAuthoredResourceConfigRawInput)[] = [
  'command',
  'generatedVariables',
  'image',
  'operations',
  'outputs',
  'ports',
  'readiness',
  'volumes',
];

export function resolveCompartmentAuthoredResourceConfigInput(
  resource: CompartmentAuthoredResourceConfigRawInput,
): CompartmentAuthoredResourceConfigInput {
  if (resource.preset !== undefined) {
    const presetResource: CompartmentAuthoredResourcePresetConfigInput = {
      preset: resource.preset,
    };
    if (resource.env !== undefined) {
      presetResource.env = resource.env;
    }
    return presetResource;
  }

  if (resource.image === undefined) {
    throw new Error('Resource config requires image or preset.');
  }

  return createFullResourceConfigInput(resource, resource.image);
}

export function normalizeCompartmentResourcePreset(
  resource: CompartmentAuthoredResourceConfigInput,
): CompartmentAuthoredResourceConfig {
  if (resource.preset === undefined) {
    return resource;
  }

  const preset: CompartmentAuthoredResourceConfig = compartmentResourcePresets[resource.preset];
  const normalizedResource: CompartmentAuthoredResourceConfig = {
    ...preset,
    env: mergeOptionalRecords(preset.env, resource.env),
    generatedVariables: resolvePresetGeneratedVariables(preset.generatedVariables, resource.env),
    preset: resource.preset,
  };

  return normalizedResource;
}

export function validateCompartmentResourcePresetOverrides(
  resource: CompartmentAuthoredResourceConfigRawInput,
  context: z.RefinementCtx,
): void {
  if (resource.preset === undefined) {
    return;
  }

  if (isSerializedNormalizedPresetResource(resource, compartmentResourcePresets)) {
    return;
  }

  for (const fieldName of compartmentResourcePresetUnsupportedFieldNames) {
    if (resource[fieldName] === undefined) {
      continue;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Preset resources support only env overrides; remove ${fieldName} or declare a full resource without preset.`,
      path: [fieldName],
    });
  }
}

function mergeOptionalRecords<T>(
  preset: Record<string, T> | undefined,
  resource: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (preset === undefined) {
    return resource;
  }
  if (resource === undefined) {
    return preset;
  }

  return {
    ...preset,
    ...resource,
  };
}

function createFullResourceConfigInput(
  resource: CompartmentAuthoredResourceConfigRawInput,
  image: string,
): CompartmentAuthoredResourceFullConfigInput {
  return {
    command: resource.command,
    env: resource.env,
    generatedVariables: resource.generatedVariables,
    image,
    operations: resource.operations,
    outputs: resource.outputs,
    ports: resource.ports,
    readiness: resource.readiness,
    volumes: resource.volumes,
  };
}

function resolvePresetGeneratedVariables(
  presetGeneratedVariables: CompartmentResourceGeneratedVariables | undefined,
  resourceEnv: CompartmentResourceEnv | undefined,
): CompartmentResourceGeneratedVariables | undefined {
  if (presetGeneratedVariables === undefined) {
    return undefined;
  }

  const generatedVariables: CompartmentResourceGeneratedVariables = Object.fromEntries(
    Object.entries(presetGeneratedVariables).filter(
      ([keyName]: [string, CompartmentResourceGeneratedVariableConfig]): boolean =>
        resourceEnv?.[keyName] === undefined,
    ),
  );

  return Object.keys(generatedVariables).length === 0 ? undefined : generatedVariables;
}
