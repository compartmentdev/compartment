import { randomUUID } from 'node:crypto';
import type { SignupRequest, SignupResponse } from '@compartment/contracts';
import {
  isCompartmentRequestError,
  isRetryableRequestError,
  signUpToCompartment,
  type CompartmentRequester,
} from '@compartment/sdk';
import { waitForAbortOrTimeout } from '@compartment/utils';
import { createApiRequester } from './context.service';
import type { ApiContext } from './context.types';

const signupMaxAttempts: number = 3;
const signupRetryBaseMs: number = 1_000;
const signupRateLimitedStatusCode: number = 429;

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
      const failure: Error = error instanceof Error ? error : new Error('Unknown network request failure.');
      if (attempt === signupMaxAttempts || !isRetryableSignupError(failure)) {
        throw failure;
      }
      await waitForAbortOrTimeout(signupRetryBaseMs * 2 ** (attempt - 1));
    }
  }

  throw new Error('Signup exhausted its retry attempts.');
}

/**
 * Signup is rate limited per minute, so a retry seconds later can only spend more of the caller's budget to be told
 * the same thing, and it would bury the failure the caller actually needs to read. Everything else the SDK calls
 * retryable is worth another attempt, because the shared key makes a replayed request safe.
 */
function isRetryableSignupError(error: Error): boolean {
  if (isCompartmentRequestError(error) && error.statusCode === signupRateLimitedStatusCode) {
    return false;
  }

  return isRetryableRequestError(error);
}
