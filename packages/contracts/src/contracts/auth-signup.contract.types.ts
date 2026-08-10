import type { LoginTokenResponse, PrincipalSummary } from './auth.contract.types';

export interface SignupRequest {
  email?: string | undefined;
  organizationName: string;
}

export type SignupResponse = LoginTokenResponse;

export interface ClaimAccountRequest {
  email: string;
  password: string;
}

export interface ClaimAccountResponse {
  principal: PrincipalSummary;
}
