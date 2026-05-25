import { timingSafeEqual } from 'node:crypto';
import { compartmentCsrfCookieName } from '@compartment/contracts';
import { hasText, readCookieValue, serializeCookie } from '@compartment/utils';
import type { ApiConfig } from '../config';
import { createToken, hashToken } from '../lib/tokens';
import { getApiConfig } from '../runtime/runtime-access';

export function createBrowserCsrfCookie(): string {
  const config: ApiConfig = getApiConfig();

  return serializeCookie(compartmentCsrfCookieName, createBrowserCsrfToken(config), {
    httpOnly: false,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  });
}

export function isMatchingBrowserCsrfToken(cookieHeader: string | undefined, headerToken: string | undefined): boolean {
  const cookieToken: string | undefined = readBrowserCsrfCookie(cookieHeader);

  return (
    isValidBrowserCsrfToken(cookieToken) &&
    headerToken !== undefined &&
    cookieToken !== undefined &&
    safeEquals(headerToken, cookieToken)
  );
}

function isValidBrowserCsrfToken(token: string | undefined): boolean {
  if (!hasText(token)) {
    return false;
  }

  const [nonce, signature, extra]: string[] = token.split('.');
  if (!hasText(nonce) || !hasText(signature) || extra !== undefined) {
    return false;
  }

  return safeEquals(signature, hashToken(nonce, getApiConfig().sessionSecret));
}

function readBrowserCsrfCookie(cookieHeader: string | undefined): string | undefined {
  return readCookieValue(cookieHeader, compartmentCsrfCookieName);
}

function createBrowserCsrfToken(config: ApiConfig): string {
  const nonce: string = createToken();
  return [nonce, hashToken(nonce, config.sessionSecret)].join('.');
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer: Buffer = Buffer.from(left);
  const rightBuffer: Buffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
