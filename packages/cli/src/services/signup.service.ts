import type { SignupRequest, SignupResponse } from '@compartment/contracts';
import { signUpToCompartment } from '@compartment/sdk';
import { createApiRequester } from './context.service';
import type { ApiContext } from './context.types';

export async function signUp(context: ApiContext, input: SignupRequest): Promise<SignupResponse> {
  return await signUpToCompartment(createApiRequester(context.apiUrl), input);
}
