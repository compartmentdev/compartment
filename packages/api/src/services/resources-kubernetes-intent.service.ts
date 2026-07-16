import type { ResourceReconcileIntent, ResourceVolumeIntent } from '@compartment/contracts';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type { ResourceRuntimeEnvValue } from './resource-operation.types';
import type { ResolvedResourceIntent } from './resources.service.helpers';
import type { ResourceEnvironmentContext } from './resources.service.types';
import type { KubernetesResourceVolumeSource } from './resources-kubernetes-reconcile.service.types';

export function buildKubernetesResourceIntent(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  intent: ResolvedResourceIntent,
  replicas: 0 | 1,
): ResourceReconcileIntent {
  return {
    command: intent.command,
    deleteData: false,
    environmentId: context.environment.id,
    env: Object.fromEntries(intent.runtimeEnv.map(buildRuntimeEnvEntry)),
    image: intent.image,
    namespaceId: context.project.id,
    operation: 'reconcile',
    ports: intent.ports,
    readiness: intent.readiness,
    replicas,
    resourceId: resource.id,
    secretId: resource.id,
    volumes: intent.volumes.map(buildResourceVolumeIntent),
  };
}

function buildRuntimeEnvEntry(variable: ResourceRuntimeEnvValue): [string, string] {
  return [variable.keyName, variable.value];
}

function buildResourceVolumeIntent(volume: KubernetesResourceVolumeSource): ResourceVolumeIntent {
  return { mountPath: volume.mountPath, size: '1Gi', volumeHandle: volume.name };
}
