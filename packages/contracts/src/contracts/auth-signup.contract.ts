import { z } from 'zod';
import { principalSummarySchema } from './auth-shared.contract';
import { loginTokenResponseSchema } from './auth.contract';
import type { ContractSchema } from './schema.types';
import type {
  ClaimAccountRequest,
  ClaimAccountResponse,
  SignupRequest,
  SignupResponse,
} from './auth-signup.contract.types';

export type {
  ClaimAccountRequest,
  ClaimAccountResponse,
  SignupRequest,
  SignupResponse,
} from './auth-signup.contract.types';

export const signupRequestSchema: ContractSchema<SignupRequest> = z
  .object({
    email: z.string().email().optional(),
    organizationName: z.string().min(1),
  })
  .strict();

/**
 * A signup idempotency key is the only proof that a retry comes from the caller that created the account, so the wire
 * contract requires a random UUID rather than any non-empty string. A guessable key would let a stranger mint a session
 * for an account they do not own.
 */
export const signupIdempotencyKeySchema: ContractSchema<string> = z.string().uuid();

export const signupResponseSchema: ContractSchema<SignupResponse> = loginTokenResponseSchema;

export const claimAccountRequestSchema: ContractSchema<ClaimAccountRequest> = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
  })
  .strict();

export const claimAccountResponseSchema: ContractSchema<ClaimAccountResponse> = z
  .object({
    principal: principalSummarySchema,
  })
  .strict();
