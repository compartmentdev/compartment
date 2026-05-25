import { ApiBoundaryError } from '../../errors/api-boundary-error';

const throttleExceededStatusCode: number = 429;
const loginRateLimitExceededCode: string = 'login_rate_limit_exceeded';
const loginRateLimitExceededMessage: string = 'Too many login attempts. Try again later.';
const activationRateLimitExceededCode: string = 'activation_rate_limit_exceeded';
const activationRateLimitExceededMessage: string = 'Too many activation attempts. Try again later.';
const resetCredentialRateLimitExceededCode: string = 'reset_password_rate_limit_exceeded';
const resetCredentialRateLimitExceededMessage: string = 'Too many password reset attempts. Try again later.';

export function createLoginThrottleExceededError(retryAfterSeconds: number): ApiBoundaryError {
  return createThrottleExceededError(loginRateLimitExceededCode, loginRateLimitExceededMessage, retryAfterSeconds);
}

export function createActivationThrottleExceededError(retryAfterSeconds: number): ApiBoundaryError {
  return createThrottleExceededError(
    activationRateLimitExceededCode,
    activationRateLimitExceededMessage,
    retryAfterSeconds,
  );
}

export function createResetPasswordThrottleExceededError(retryAfterSeconds: number): ApiBoundaryError {
  return createThrottleExceededError(
    resetCredentialRateLimitExceededCode,
    resetCredentialRateLimitExceededMessage,
    retryAfterSeconds,
  );
}

function createThrottleExceededError(code: string, message: string, retryAfterSeconds: number): ApiBoundaryError {
  return new ApiBoundaryError(throttleExceededStatusCode, code, message, {
    'Retry-After': String(retryAfterSeconds),
  });
}
