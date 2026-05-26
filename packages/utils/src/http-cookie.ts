import { assertHttpHeaderName, assertHttpHeaderValue } from './http-header';

type CookieSameSite = 'Lax' | 'Strict' | 'None';

interface CookieSerializeOptions {
  domain?: string | undefined;
  expires?: Date | undefined;
  httpOnly?: boolean | undefined;
  maxAgeSeconds?: number | undefined;
  path?: string | undefined;
  sameSite?: CookieSameSite | undefined;
  secure?: boolean | undefined;
}

export function readCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const [cookieName, ...valueParts] = part.trim().split('=');
    if (cookieName === name) {
      return valueParts.join('=');
    }
  }

  return undefined;
}

export function serializeCookie(name: string, value: string, options: CookieSerializeOptions = {}): string {
  assertCookieName(name);
  assertCookieValue(value, 'cookie value');
  assertValidCookiePrefixOptions(name, options);

  return [
    `${name}=${value}`,
    readDomainAttribute(options.domain),
    readPathAttribute(options.path),
    readExpiresAttribute(options.expires),
    readMaxAgeAttribute(options.maxAgeSeconds),
    readHttpOnlyAttribute(options.httpOnly),
    readSameSiteAttribute(options.sameSite),
    readSecureAttribute(options.secure),
  ]
    .filter((attribute: string | null): attribute is string => attribute !== null)
    .join('; ');
}

function assertValidCookiePrefixOptions(name: string, options: CookieSerializeOptions): void {
  if (!name.startsWith('__Host-')) {
    return;
  }
  if (options.domain !== undefined || options.path !== '/' || options.secure !== true) {
    throw new Error('__Host- cookies require Secure, Path=/, and no Domain attribute.');
  }
}

function readDomainAttribute(domain: string | undefined): string | null {
  if (domain === undefined) {
    return null;
  }

  return createCookieAttribute(`Domain=${domain}`, 'cookie Domain attribute');
}

function readPathAttribute(path: string | undefined): string {
  const pathValue: string = path ?? '/';
  return createCookieAttribute(`Path=${pathValue}`, 'cookie Path attribute');
}

function readExpiresAttribute(expires: Date | undefined): string | null {
  if (expires === undefined) {
    return null;
  }

  const expiresValue: string = expires.toUTCString();
  return createCookieAttribute(`Expires=${expiresValue}`, 'cookie Expires attribute');
}

function readMaxAgeAttribute(maxAgeSeconds: number | undefined): string | null {
  return maxAgeSeconds !== undefined
    ? createCookieAttribute(`Max-Age=${maxAgeSeconds}`, 'cookie Max-Age attribute')
    : null;
}

function readHttpOnlyAttribute(httpOnly: boolean | undefined): string | null {
  return httpOnly !== false ? createCookieAttribute('HttpOnly', 'cookie HttpOnly attribute') : null;
}

function readSameSiteAttribute(sameSite: CookieSameSite | undefined): string | null {
  if (sameSite === undefined) {
    return null;
  }

  return createCookieAttribute(`SameSite=${sameSite}`, 'cookie SameSite attribute');
}

function readSecureAttribute(secure: boolean | undefined): string | null {
  return secure === true ? createCookieAttribute('Secure', 'cookie Secure attribute') : null;
}

function createCookieAttribute(attribute: string, label: string): string {
  assertCookieAttributeValue(attribute, label);
  return attribute;
}

function assertCookieAttributeValue(value: string, label: string): void {
  assertCookieValue(value, label);
}

function assertCookieValue(value: string, label: string): void {
  assertHttpHeaderValue(value, label);
  assertNoCookieSemicolon(value, label);
}

function assertCookieName(name: string): void {
  assertHttpHeaderName(name, 'cookie name');
}

function assertNoCookieSemicolon(value: string, label: string): void {
  if (value.includes(';')) {
    throw new Error(`Invalid ${label}.`);
  }
}
