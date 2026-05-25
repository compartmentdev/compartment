import {
  buildCompartmentProjectStartApiPathname,
  projectLifecycleResponseSchema,
  type ProjectLifecycleRequest,
  type ProjectLifecycleResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function startProject(
  request: CompartmentRequester,
  projectName: string,
  input: ProjectLifecycleRequest = {},
): Promise<ProjectLifecycleResponse> {
  return await request<ProjectLifecycleResponse, ProjectLifecycleRequest>({
    body: input,
    method: 'POST',
    path: buildCompartmentProjectStartApiPathname(projectName),
    schema: projectLifecycleResponseSchema,
  });
}
