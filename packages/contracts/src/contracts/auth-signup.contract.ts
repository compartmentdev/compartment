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
 * contract requires a random UUID rather than any non-empty string: a guessable key would let a stranger mint a session
 * for an account they do not own. The pattern is version 4 specifically, because the generic UUID shape also admits the
 * nil UUID and the time-and-MAC versions, which are exactly the values a caller reaches for when it is not generating
 * anything random. Syntax cannot prove the value came from a CSPRNG, so callers must still generate it as one.
 */
const signupIdempotencyKeyPattern: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const signupIdempotencyKeySchema: ContractSchema<string> = z.string().regex(signupIdempotencyKeyPattern);

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
