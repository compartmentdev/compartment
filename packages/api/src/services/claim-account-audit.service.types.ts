export interface AccountClaimAuditRequestContext {
  sessionId: string;
  sourceIp: string;
  transport: string;
  userAgent: string | null;
}

export interface RecordAccountClaimAuditInput {
  context: AccountClaimAuditRequestContext;
  email: string;
  previousEmail: string;
  principalId: string;
}
