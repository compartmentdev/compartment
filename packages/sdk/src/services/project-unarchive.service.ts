import {
  buildCompartmentProjectUnarchiveApiPathname,
  projectResponseSchema,
  type ProjectResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function unarchiveProject(request: CompartmentRequester, projectName: string): Promise<ProjectResponse> {
  return await request<ProjectResponse, undefined>({
    method: 'POST',
    path: buildCompartmentProjectUnarchiveApiPathname(projectName),
    schema: projectResponseSchema,
  });
}
