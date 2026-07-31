import type { AuditEventActorInput } from './audit-events.service.types';
import type { LoginServiceResult } from './login.service.types';

export interface LoginAuditRequestContext {
  sourceIp: string;
  transport: string;
  userAgent: string | null;
}

export interface RecordSuccessfulLoginAuditInput {
  context: LoginAuditRequestContext;
  result: LoginServiceResult;
}

export interface RecordFailedLoginAuditInput {
  context: LoginAuditRequestContext;
  email: string;
  organizationSlug?: string | undefined;
}

export type LoginAuditActor = AuditEventActorInput;
