export interface ClientOptions {
  apiUrl: string;
  currentOrganization?: string;
  internalToken?: string;
  requestTimeoutMs?: number | null;
  sessionToken?: string;
}
