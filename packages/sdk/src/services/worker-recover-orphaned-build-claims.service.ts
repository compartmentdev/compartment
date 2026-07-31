import {
  workerRecoverOrphanedBuildClaimsPathname,
  workerRecoverOrphanedBuildClaimsRequestSchema,
  workerRecoverOrphanedBuildClaimsResponseSchema,
  type WorkerRecoverOrphanedBuildClaimsRequest,
  type WorkerRecoverOrphanedBuildClaimsResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function recoverOrphanedBuildClaims(
  request: CompartmentRequester,
  body: WorkerRecoverOrphanedBuildClaimsRequest,
): Promise<WorkerRecoverOrphanedBuildClaimsResponse> {
  return await request<WorkerRecoverOrphanedBuildClaimsResponse, WorkerRecoverOrphanedBuildClaimsRequest>({
    body: workerRecoverOrphanedBuildClaimsRequestSchema.parse(body),
    method: 'POST',
    path: workerRecoverOrphanedBuildClaimsPathname,
    schema: workerRecoverOrphanedBuildClaimsResponseSchema,
  });
}
