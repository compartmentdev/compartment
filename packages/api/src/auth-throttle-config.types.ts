export interface ApiRouteThrottleConfig {
  maxRequests: number;
  windowMs: number;
}

export interface ApiCooldownThrottleConfig {
  blockMs: number;
  maxFailures: number;
  windowMs: number;
}

export interface ApiAuthLoginThrottleConfig {
  account: ApiCooldownThrottleConfig;
  route: ApiRouteThrottleConfig;
  source: ApiCooldownThrottleConfig;
  sourceAccount: ApiCooldownThrottleConfig;
}

export interface ApiAuthSubjectThrottleConfig {
  route: ApiRouteThrottleConfig;
  source: ApiCooldownThrottleConfig;
  sourceSubject: ApiCooldownThrottleConfig;
  subject: ApiCooldownThrottleConfig;
}

export type ApiAuthActivationThrottleConfig = ApiAuthSubjectThrottleConfig;
export type ApiAuthResetPasswordThrottleConfig = ApiAuthSubjectThrottleConfig;

export interface ApiAuthThrottleConfig {
  activation: ApiAuthActivationThrottleConfig;
  login: ApiAuthLoginThrottleConfig;
  resetPassword: ApiAuthResetPasswordThrottleConfig;
}
