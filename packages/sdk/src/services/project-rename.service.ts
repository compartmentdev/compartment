import {
  buildCompartmentProjectApiPathname,
  projectResponseSchema,
  renameProjectRequestSchema,
  type ProjectResponse,
  type RenameProjectRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function renameProject(
  request: CompartmentRequester,
  projectName: string,
  body: RenameProjectRequest,
): Promise<ProjectResponse> {
  const payload: RenameProjectRequest = renameProjectRequestSchema.parse(body);
  return await request<ProjectResponse, RenameProjectRequest>({
    body: payload,
    method: 'PATCH',
    path: buildCompartmentProjectApiPathname(projectName),
    schema: projectResponseSchema,
  });
}
