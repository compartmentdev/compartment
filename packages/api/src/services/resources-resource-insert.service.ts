import { createId } from '../lib/tokens';
import type { CreateProjectResourceInput } from '../queries/resources.query.types';
import type { ResolvedResourceIntent } from './resources.service.helpers';
import {
  serializeResourceCommand,
  serializeResourceEnv,
  serializeResourceOperations,
  serializeResourceOutputs,
  serializeResourcePorts,
  serializeResourceReadiness,
  serializeResourceVolumes,
} from './resources.service.storage';

export function createResourceInsert(
  environmentId: string,
  intent: ResolvedResourceIntent,
  now: Date,
  runtimeKind: 'node' | 'kubernetes',
): CreateProjectResourceInput {
  return {
    ...createResourceInsertDefinition(environmentId, intent),
    runtimeKind,
    id: createId('res'),
    status: 'stopped',
    updatedAt: now,
  };
}

function createResourceInsertDefinition(
  environmentId: string,
  intent: ResolvedResourceIntent,
): Omit<CreateProjectResourceInput, 'id' | 'runtimeKind' | 'status' | 'updatedAt'> {
  return {
    commandJson: serializeResourceCommand(intent.command),
    envJson: serializeResourceEnv(intent.storedEnv),
    environmentId,
    hostname: intent.hostname,
    image: intent.image,
    name: intent.name,
    operationConfigHash: intent.operationConfigHash,
    operationsJson: serializeResourceOperations(intent.operations),
    outputsJson: serializeResourceOutputs(intent.outputs),
    portsJson: serializeResourcePorts(intent.ports),
    readinessJson: serializeResourceReadiness(intent.readiness),
    restartPolicy: intent.restartPolicy,
    runtimeDefinitionHash: intent.runtimeHash,
    volumesJson: serializeResourceVolumes(intent.volumes),
  };
}
