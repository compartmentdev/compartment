import {
  compartmentAuthSignupPathname,
  signupResponseSchema,
  type SignupRequest,
  type SignupResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function signUpToCompartment(
  request: CompartmentRequester,
  body: SignupRequest,
  idempotencyKey: string,
): Promise<SignupResponse> {
  return await request<SignupResponse, SignupRequest>({
    body,
    idempotencyKey,
    method: 'POST',
    path: compartmentAuthSignupPathname,
    schema: signupResponseSchema,
  });
}
