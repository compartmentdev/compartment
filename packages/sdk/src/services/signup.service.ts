import {
  compartmentAuthSignupPathname,
  signupResponseSchema,
  type SignupRequest,
  type SignupResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function signUpToCompartment(request: CompartmentRequester, body: SignupRequest): Promise<SignupResponse> {
  return await request<SignupResponse, SignupRequest>({
    body,
    method: 'POST',
    path: compartmentAuthSignupPathname,
    schema: signupResponseSchema,
  });
}
