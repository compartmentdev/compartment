import type { ApiConfig } from '../config';
import { browserResetPasswordPathname } from '../browser-public-paths';
import { createToken } from '../lib/tokens';
import { buildBrowserAuthTokenUrl } from './browser-auth-token-url.service';
import type { IssuePasswordResetPlan, IssuePasswordResetPlanInput } from './password-reset-issue.service.types';
import type { PasswordResetPlan } from './password-reset.service.types';

const passwordResetTtlMs: number = 24 * 60 * 60 * 1000;

export function createIssuePasswordResetPlan(input: IssuePasswordResetPlanInput): IssuePasswordResetPlan {
  const now: Date = new Date();

  return {
    config: input.config,
    email: input.email,
    expiresAt: new Date(now.getTime() + passwordResetTtlMs),
    now,
    resetToken: createToken(),
  };
}

export function createResetPlan(
  email: string,
  newPassword: string,
  resetToken: string,
  config: ApiConfig,
): PasswordResetPlan {
  return {
    config,
    email,
    newPassword,
    resetToken,
  };
}

export function buildPasswordResetUrl(email: string, resetToken: string, config: ApiConfig): string {
  return buildBrowserAuthTokenUrl(browserResetPasswordPathname, email, resetToken, config);
}
