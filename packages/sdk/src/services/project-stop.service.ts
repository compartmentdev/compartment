import {
  buildCompartmentProjectStopApiPathname,
  projectLifecycleResponseSchema,
  type ProjectLifecycleRequest,
  type ProjectLifecycleResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function stopProject(
  request: CompartmentRequester,
  projectName: string,
  input: ProjectLifecycleRequest = {},
): Promise<ProjectLifecycleResponse> {
  return await request<ProjectLifecycleResponse, ProjectLifecycleRequest>({
    body: input,
    method: 'POST',
    path: buildCompartmentProjectStopApiPathname(projectName),
    schema: projectLifecycleResponseSchema,
  });
}
