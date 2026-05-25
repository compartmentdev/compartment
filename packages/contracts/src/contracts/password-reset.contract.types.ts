import type {
  ActivateResponse,
  AuthTokenStateQuery,
  AuthTokenStateResponse,
  AuthFlowTargetFields,
  AuthSessionDelivery,
} from './auth.contract.types';

export type ResetPasswordStateQuery = AuthTokenStateQuery;

export type ResetPasswordStateResponse = AuthTokenStateResponse;

export interface ResetPasswordRequest extends AuthFlowTargetFields {
  email: string;
  password: string;
  resetToken?: string | undefined;
  sessionDelivery?: AuthSessionDelivery | undefined;
}

export type ResetPasswordResponse = ActivateResponse;

export interface IssuePasswordResetRequest {
  email: string;
}

export interface IssuePasswordResetResponse {
  email: string;
  expiresAt: string;
  resetUrl: string;
  resetToken: string;
}
