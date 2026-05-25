import type { ApiConfig } from '../config';

export interface IssuePasswordResetInput {
  email: string;
}

export interface IssuePasswordResetResult {
  email: string;
  expiresAt: Date;
  resetToken: string;
  resetUrl: string;
}

export interface RejectOrganizationUserPasswordResetInput {
  email: string;
  organizationId: string;
}

export interface IssuePasswordResetPlan {
  config: ApiConfig;
  email: string;
  expiresAt: Date;
  now: Date;
  resetToken: string;
}

export interface IssuePasswordResetPlanInput {
  config: ApiConfig;
  email: string;
}
