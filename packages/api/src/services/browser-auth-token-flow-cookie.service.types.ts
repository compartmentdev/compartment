export type BrowserAuthTokenFlowCookieName = `__Host-${string}`;

export interface BrowserAuthTokenFlowCookieOptions {
  expires?: Date | undefined;
  maxAgeSeconds?: number | undefined;
}
