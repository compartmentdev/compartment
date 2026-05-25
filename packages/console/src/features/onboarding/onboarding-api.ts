import {
  buildCompartmentFirstDeployOnboardingSessionPathname,
  buildCompartmentFirstDeployOnboardingStatusPathname,
  compartmentFirstDeployOnboardingPathname,
  createFirstDeployOnboardingSessionRequestSchema,
  firstDeployOnboardingSessionResponseSchema,
  firstDeployOnboardingStatusResponseSchema,
  patchFirstDeployOnboardingSessionRequestSchema,
  type CreateFirstDeployOnboardingSessionRequest,
  type FirstDeployOnboardingSessionResponse,
  type FirstDeployOnboardingStatusResponse,
  type PatchFirstDeployOnboardingSessionRequest,
} from '@compartment/contracts/browser';
import { requestBrowserApi } from '../../lib/browser-api';

export async function createBrowserFirstDeployOnboardingSession(
  currentOrganization: string,
  body: CreateFirstDeployOnboardingSessionRequest,
): Promise<FirstDeployOnboardingSessionResponse> {
  return await requestBrowserApi(compartmentFirstDeployOnboardingPathname, firstDeployOnboardingSessionResponseSchema, {
    currentOrganization,
    json: createFirstDeployOnboardingSessionRequestSchema.parse(body),
    method: 'POST',
  });
}

export async function readBrowserFirstDeployOnboardingSession(
  currentOrganization: string,
  sessionId: string,
): Promise<FirstDeployOnboardingSessionResponse> {
  return await requestBrowserApi(
    buildCompartmentFirstDeployOnboardingSessionPathname(sessionId),
    firstDeployOnboardingSessionResponseSchema,
    { currentOrganization },
  );
}

export async function patchBrowserFirstDeployOnboardingSession(
  currentOrganization: string,
  sessionId: string,
  body: PatchFirstDeployOnboardingSessionRequest,
): Promise<FirstDeployOnboardingSessionResponse> {
  return await requestBrowserApi(
    buildCompartmentFirstDeployOnboardingSessionPathname(sessionId),
    firstDeployOnboardingSessionResponseSchema,
    {
      currentOrganization,
      json: patchFirstDeployOnboardingSessionRequestSchema.parse(body),
      method: 'PATCH',
    },
  );
}

export async function readBrowserFirstDeployOnboardingStatus(
  currentOrganization: string,
  sessionId: string,
): Promise<FirstDeployOnboardingStatusResponse> {
  return await requestBrowserApi(
    buildCompartmentFirstDeployOnboardingStatusPathname(sessionId),
    firstDeployOnboardingStatusResponseSchema,
    { currentOrganization },
  );
}
