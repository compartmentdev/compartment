import {
  buildCompartmentProjectArchiveApiPathname,
  projectResponseSchema,
  type ProjectResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function archiveProject(request: CompartmentRequester, projectName: string): Promise<ProjectResponse> {
  return await request<ProjectResponse, undefined>({
    method: 'POST',
    path: buildCompartmentProjectArchiveApiPathname(projectName),
    schema: projectResponseSchema,
  });
}
