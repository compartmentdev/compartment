import type { AppRouteAccessMode } from '@compartment/contracts';
import { getApiConfig } from '../runtime/runtime-access';

export function resolveNewProjectDefaultAccessMode(): AppRouteAccessMode {
  return getApiConfig().newProjectsPrivateByDefault ? 'authenticated' : 'public';
}
