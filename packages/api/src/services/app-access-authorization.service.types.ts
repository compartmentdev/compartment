import type { CompartmentRouteRequestPath } from '@compartment/contracts';
import type { AuthSessionActorRow } from '../queries/authentication.query.types';

export interface AppRouteAccessEvaluationInput {
  host: string;
  method?: string | undefined;
  path: string;
  session: AuthSessionActorRow;
}

export interface AppRouteAccessCheckInput {
  host: string;
  path: string;
  session: AuthSessionActorRow;
}

export type AppRouteAccessRequestPath = CompartmentRouteRequestPath;
