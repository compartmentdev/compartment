import type { JsonValue } from '@compartment/utils';
import { z, type SafeParseReturnType, type ZodType } from 'zod';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import type { ProjectResourceRow } from '../queries/resources.query.types';

const storedResourceDefinitionSnapshotVersion: StoredResourceDefinitionSnapshotVersion = 1;

type StoredResourceDefinitionSnapshotVersion = 1;

export interface StoredResourceDefinitionSnapshot {
  commandJson: string;
  envJson: string;
  image: string;
  operationConfigHash: string;
  operationsJson: string;
  portsJson: string;
  readinessJson: string;
  runtimeDefinitionHash: string;
  version: StoredResourceDefinitionSnapshotVersion;
  volumesJson: string;
}

const storedResourceDefinitionSnapshotSchema: ZodType<StoredResourceDefinitionSnapshot> = z.object({
  commandJson: z.string(),
  envJson: z.string(),
  image: z.string(),
  operationConfigHash: z.string(),
  operationsJson: z.string(),
  portsJson: z.string(),
  readinessJson: z.string(),
  runtimeDefinitionHash: z.string(),
  version: z.literal(storedResourceDefinitionSnapshotVersion),
  volumesJson: z.string(),
});

export function buildResourceDefinitionSnapshot(resource: ProjectResourceRow): StoredResourceDefinitionSnapshot {
  return {
    commandJson: resource.commandJson,
    envJson: resource.envJson,
    image: resource.image,
    operationConfigHash: resource.operationConfigHash,
    operationsJson: resource.operationsJson,
    portsJson: resource.portsJson,
    readinessJson: resource.readinessJson,
    runtimeDefinitionHash: resource.runtimeDefinitionHash,
    version: storedResourceDefinitionSnapshotVersion,
    volumesJson: resource.volumesJson,
  };
}

export function parseStoredResourceDefinitionSnapshot(value: JsonValue): StoredResourceDefinitionSnapshot {
  const result: SafeParseReturnType<JsonValue, StoredResourceDefinitionSnapshot> =
    storedResourceDefinitionSnapshotSchema.safeParse(value);
  if (!result.success) {
    throw createInvalidDeployConfigError('Resource backup contains an unsupported resource definition snapshot.');
  }

  return result.data;
}
