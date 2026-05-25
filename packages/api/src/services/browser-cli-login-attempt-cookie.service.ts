import { compartmentCliLoginAttemptCookieName } from '@compartment/contracts';
import { readCookieValue, serializeCookie } from '@compartment/utils';

export interface BrowserCliLoginAttemptCookieValue {
  attemptId: string;
  browserCode: string;
}

export function readBrowserCliLoginAttemptCookie(
  cookieHeader: string | undefined,
): BrowserCliLoginAttemptCookieValue | undefined {
  const value: string | undefined = readCookieValue(cookieHeader, compartmentCliLoginAttemptCookieName);
  if (value === undefined) {
    return undefined;
  }

  const separatorIndex: number = value.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return undefined;
  }

  return {
    attemptId: value.slice(0, separatorIndex),
    browserCode: value.slice(separatorIndex + 1),
  };
}

export function createBrowserCliLoginAttemptCookie(attemptId: string, browserCode: string, expiresAt: Date): string {
  return serializeCookie(compartmentCliLoginAttemptCookieName, `${attemptId}:${browserCode}`, {
    expires: expiresAt,
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  });
}

export function createClearedBrowserCliLoginAttemptCookie(): string {
  return serializeCookie(compartmentCliLoginAttemptCookieName, '', {
    expires: new Date(0),
    httpOnly: true,
    maxAgeSeconds: 0,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  });
}
