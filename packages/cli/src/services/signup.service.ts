import { randomUUID } from 'node:crypto';
import type { SignupRequest, SignupResponse } from '@compartment/contracts';
import { isRetryableRequestError, signUpToCompartment, type CompartmentRequester } from '@compartment/sdk';
import { waitForAbortOrTimeout } from '@compartment/utils';
import { createApiRequester } from './context.service';
import type { ApiContext } from './context.types';

/**
 * Three attempts stay inside the signup rate limit of five requests per minute, so a full retry cycle still leaves the
 * caller room to run the command again.
 */
const signupMaxAttempts: number = 3;
const signupRetryBaseMs: number = 1_000;

/**
 * The key is minted once for the whole command and reused by every attempt: that is what makes a lost response
 * recoverable. A request that times out may already have created the account, and without the shared key the retry
 * would report the email address as taken and strand an account nobody can log into.
 */
export async function signUp(context: ApiContext, input: SignupRequest): Promise<SignupResponse> {
  const requester: CompartmentRequester = createApiRequester(context.apiUrl);
  const idempotencyKey: string = randomUUID();

  for (let attempt: number = 1; attempt <= signupMaxAttempts; attempt += 1) {
    try {
      return await signUpToCompartment(requester, input, idempotencyKey);
    } catch (error) {
      if (attempt === signupMaxAttempts || !isRetryableRequestError(error as Error | undefined)) {
        throw error;
      }
      await waitForAbortOrTimeout(signupRetryBaseMs * 2 ** (attempt - 1));
    }
  }

  throw new Error('Signup exhausted its retry attempts.');
}
