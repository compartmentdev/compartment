import {
  appAccessStateResponseSchema,
  type AppAccessStateResponse,
  type AppAccessStateSnapshot,
} from '@compartment/contracts';

export function buildAppAccessStateResponse(state: AppAccessStateSnapshot | null): AppAccessStateResponse {
  return appAccessStateResponseSchema.parse({ state });
}
