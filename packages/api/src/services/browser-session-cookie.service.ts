import { compartmentSessionCookieName } from '@compartment/contracts';
import { serializeCookie } from '@compartment/utils';

export function createCompartmentSessionCookie(sessionToken: string, expiresAt: Date): string {
  return serializeCookie(compartmentSessionCookieName, sessionToken, {
    expires: expiresAt,
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  });
}

export function createClearedCompartmentSessionCookie(): string {
  return serializeCookie(compartmentSessionCookieName, '', {
    expires: new Date(0),
    httpOnly: true,
    maxAgeSeconds: 0,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  });
}
