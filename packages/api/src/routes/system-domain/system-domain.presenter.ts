import {
  systemDomainMutationResponseSchema,
  systemDomainStatusResponseSchema,
  type SystemDomainMutationResponse,
  type SystemDomainStatusResponse,
} from '@compartment/contracts';
import type { SystemDomainMutationResult, SystemDomainStatusResult } from '../../services/system-domain.service.types';

export function buildSystemDomainStatusResponse(result: SystemDomainStatusResult): SystemDomainStatusResponse {
  return systemDomainStatusResponseSchema.parse(result);
}

export function buildSystemDomainMutationResponse(result: SystemDomainMutationResult): SystemDomainMutationResponse {
  return systemDomainMutationResponseSchema.parse(result);
}
