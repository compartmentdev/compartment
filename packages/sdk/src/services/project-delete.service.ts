import {
  buildCompartmentProjectApiPathname,
  projectDeleteResponseSchema,
  type ProjectDeleteResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function deleteProject(
  request: CompartmentRequester,
  projectName: string,
): Promise<ProjectDeleteResponse> {
  return await request<ProjectDeleteResponse, undefined>({
    method: 'DELETE',
    path: buildCompartmentProjectApiPathname(projectName),
    schema: projectDeleteResponseSchema,
  });
}
