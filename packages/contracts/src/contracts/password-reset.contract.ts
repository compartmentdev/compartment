import { z } from 'zod';
import { activateResponseSchema } from './auth.contract';
import {
  authFlowFieldsSchema,
  authSessionDeliverySchema,
  authTokenStateQuerySchema,
  authTokenStateResponseSchema,
} from './auth-shared.contract';
import type { ContractSchema } from './schema.types';
import type {
  IssuePasswordResetRequest,
  IssuePasswordResetResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  ResetPasswordStateQuery,
  ResetPasswordStateResponse,
} from './password-reset.contract.types';

export type {
  IssuePasswordResetRequest,
  IssuePasswordResetResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  ResetPasswordStateQuery,
  ResetPasswordStateResponse,
} from './password-reset.contract.types';
export const resetPasswordStateQuerySchema: ContractSchema<ResetPasswordStateQuery> = authTokenStateQuerySchema;

export const resetPasswordStateResponseSchema: ContractSchema<ResetPasswordStateResponse> =
  authTokenStateResponseSchema;

type PasswordResetLinkResponseObjectSchema = z.ZodObject<{
  email: z.ZodString;
  expiresAt: z.ZodString;
  resetUrl: z.ZodString;
}>;

export const resetPasswordRequestSchema: ContractSchema<ResetPasswordRequest> = z
  .object({
    ...authFlowFieldsSchema,
    email: z.string().email(),
    password: z.string().min(8),
    resetToken: z.string().min(1).optional(),
    sessionDelivery: authSessionDeliverySchema.optional(),
  })
  .strict();

export const resetPasswordResponseSchema: ContractSchema<ResetPasswordResponse> = activateResponseSchema;

export const issuePasswordResetRequestSchema: ContractSchema<IssuePasswordResetRequest> = z
  .object({
    email: z.string().email(),
  })
  .strict();

const passwordResetLinkResponseSchema: PasswordResetLinkResponseObjectSchema = z
  .object({
    email: z.string().email(),
    expiresAt: z.string().datetime(),
    resetUrl: z.string().url(),
  })
  .strict();

export const issuePasswordResetResponseSchema: ContractSchema<IssuePasswordResetResponse> =
  passwordResetLinkResponseSchema
    .extend({
      resetToken: z.string().min(1),
    })
    .strict();
