export type AuthThrottleFieldInput = boolean | number | object | string | null | undefined;

export interface AuthThrottleFields {
  email?: string | undefined;
  host?: string | undefined;
  organizationSlug?: string | undefined;
}

export interface LoginThrottleIdentity {
  accountKey: string;
  sourceAccountKey: string;
  sourceKey: string;
}

export interface SubjectThrottleIdentity {
  sourceKey: string;
  sourceSubjectKey: string;
  subjectKey: string;
}

export type ActivationThrottleIdentity = SubjectThrottleIdentity;
export type ResetPasswordThrottleIdentity = SubjectThrottleIdentity;
