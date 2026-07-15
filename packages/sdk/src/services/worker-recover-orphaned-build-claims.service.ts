import {
  workerRecoverOrphanedBuildClaimsPathname,
  workerRecoverOrphanedBuildClaimsResponseSchema,
  type WorkerRecoverOrphanedBuildClaimsResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function recoverOrphanedBuildClaims(
  request: CompartmentRequester,
): Promise<WorkerRecoverOrphanedBuildClaimsResponse> {
  return await request<WorkerRecoverOrphanedBuildClaimsResponse, undefined>({
    method: 'POST',
    path: workerRecoverOrphanedBuildClaimsPathname,
    schema: workerRecoverOrphanedBuildClaimsResponseSchema,
  });
}
