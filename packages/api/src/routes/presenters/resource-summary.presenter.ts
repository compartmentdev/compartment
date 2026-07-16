import type { ResourceSummary } from '@compartment/contracts';
import type { ResourceSummaryInput } from '../../services/resources.service.types';
import {
  parseResourceEnv,
  parseResourcePorts,
  parseResourceReadiness,
  parseResourceVolumes,
  presentResourceRuntimeStatus,
} from '../../services/resources.service.storage';

export function buildResourceSummary(resource: ResourceSummaryInput): ResourceSummary {
  return {
    createdAt: resource.createdAt.toISOString(),
    env: parseResourceEnv(resource),
    id: resource.id,
    image: resource.image,
    name: resource.name,
    ports: parseResourcePorts(resource),
    readiness: parseResourceReadiness(resource),
    status: presentResourceRuntimeStatus(resource.status),
    updatedAt: resource.updatedAt.toISOString(),
    volumes: parseResourceVolumes(resource),
  };
}
