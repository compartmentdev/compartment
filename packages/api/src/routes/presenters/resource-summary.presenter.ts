import type { ResourceSummary } from '@compartment/contracts';
import type { ResourceSummaryInput } from '../../services/resources.service.types';
import {
  parseResourceEnv,
  parseResourcePorts,
  parseResourceReadiness,
  parseResourceRestartPolicy,
  parseResourceVolumes,
} from '../../services/resources.service.storage';

export function buildResourceSummary(resource: ResourceSummaryInput): ResourceSummary {
  return {
    containerId: resource.containerId,
    createdAt: resource.createdAt.toISOString(),
    env: parseResourceEnv(resource),
    hostname: resource.hostname,
    id: resource.id,
    image: resource.image,
    name: resource.name,
    ports: parseResourcePorts(resource),
    readiness: parseResourceReadiness(resource),
    restartPolicy: parseResourceRestartPolicy(resource),
    status: resource.status,
    updatedAt: resource.updatedAt.toISOString(),
    volumes: parseResourceVolumes(resource),
  };
}
