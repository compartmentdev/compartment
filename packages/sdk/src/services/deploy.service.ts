import {
  compartmentDeploymentsPathname,
  deployResponseSchema,
  type CompartmentAuthoredDescriptorInput,
  type CompartmentRoutesFile,
  type DeployRequestInput,
  type DeployResponse,
  type SourceUploadSummary,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { createSourceUpload } from './source-upload.service';

interface DeployProjectInput {
  descriptor: CompartmentAuthoredDescriptorInput;
  environmentName?: string | undefined;
  label?: string | undefined;
  onboardingSessionId?: string | undefined;
  projectName: string;
  routes?: CompartmentRoutesFile | undefined;
  serviceName?: string | undefined;
}

export async function deployProject(
  request: CompartmentRequester,
  body: DeployProjectInput,
  sourceArchive: Uint8Array,
): Promise<DeployResponse> {
  const sourceUpload: SourceUploadSummary = await createSourceUpload(request, sourceArchive, {
    ...(body.environmentName !== undefined ? { environmentName: body.environmentName } : {}),
    projectName: body.projectName,
  });

  return await createDeployment(request, {
    descriptor: body.descriptor,
    environmentName: body.environmentName,
    label: body.label,
    onboardingSessionId: body.onboardingSessionId,
    routes: body.routes,
    serviceName: body.serviceName,
    sourceUploadId: sourceUpload.id,
  });
}

async function createDeployment(request: CompartmentRequester, body: DeployRequestInput): Promise<DeployResponse> {
  return await request<DeployResponse, DeployRequestInput>({
    body,
    method: 'POST',
    path: compartmentDeploymentsPathname,
    schema: deployResponseSchema,
  });
}
