import {
  buildCompartmentProjectApiPathname,
  projectReadResponseSchema,
  type ProjectReadResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function getProject(request: CompartmentRequester, projectName: string): Promise<ProjectReadResponse> {
  return await request<ProjectReadResponse, undefined>({
    method: 'GET',
    path: buildCompartmentProjectApiPathname(projectName),
    schema: projectReadResponseSchema,
  });
}
