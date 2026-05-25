import type { ApiBusinessErrorDefinition } from './api-business-error.types';
import { compartmentConsoleSsoFailedLoginErrorMessage as invalidSsoLoginBusinessErrorMessage } from '@compartment/contracts';

type AuthApiBusinessErrorCode =
  | 'invalid_app_access_code'
  | 'invalid_bootstrap_token'
  | 'invalid_password_reset_token'
  | 'invalid_browser_flow'
  | 'invalid_cli_login'
  | 'invalid_credentials'
  | 'invalid_sso_login'
  | 'invalid_sso_provider_config'
  | 'login_method_required'
  | 'password_reset_not_available'
  | 'password_reset_user_not_found';

export const authBusinessErrorDefinitions: Record<AuthApiBusinessErrorCode, ApiBusinessErrorDefinition> = {
  invalid_app_access_code: {
    message: 'The app access code is invalid or expired.',
    statusCode: 401,
  },
  invalid_bootstrap_token: {
    message: 'The invitation token is invalid or expired.',
    statusCode: 401,
  },
  invalid_password_reset_token: {
    message: 'The password reset token is invalid or expired.',
    statusCode: 401,
  },
  invalid_browser_flow: {
    message: 'A valid browser flow target is required.',
    statusCode: 400,
  },
  invalid_credentials: {
    message: 'Invalid email or password.',
    statusCode: 401,
  },
  invalid_cli_login: {
    message: 'The CLI login attempt is invalid or expired.',
    statusCode: 401,
  },
  invalid_sso_login: {
    message: invalidSsoLoginBusinessErrorMessage,
    statusCode: 401,
  },
  invalid_sso_provider_config: {
    message: 'The SSO provider configuration is invalid.',
    statusCode: 400,
  },
  login_method_required: {
    message: 'Each organization must keep at least one enabled login method.',
    statusCode: 409,
  },
  password_reset_not_available: {
    message: 'Password reset is not available for this user.',
    statusCode: 409,
  },
  password_reset_user_not_found: {
    message: 'The requested user was not found.',
    statusCode: 404,
  },
};
