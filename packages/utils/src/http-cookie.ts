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
  assertValidCookiePrefixOptions(name, options);

  return [
    `${name}=${value}`,
    readDomainAttribute(options.domain),
    `Path=${options.path ?? '/'}`,
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
  return domain !== undefined ? `Domain=${domain}` : null;
}

function readExpiresAttribute(expires: Date | undefined): string | null {
  return expires !== undefined ? `Expires=${expires.toUTCString()}` : null;
}

function readMaxAgeAttribute(maxAgeSeconds: number | undefined): string | null {
  return maxAgeSeconds !== undefined ? `Max-Age=${maxAgeSeconds}` : null;
}

function readHttpOnlyAttribute(httpOnly: boolean | undefined): string | null {
  return httpOnly !== false ? 'HttpOnly' : null;
}

function readSameSiteAttribute(sameSite: CookieSameSite | undefined): string | null {
  return sameSite !== undefined ? `SameSite=${sameSite}` : null;
}

function readSecureAttribute(secure: boolean | undefined): string | null {
  return secure === true ? 'Secure' : null;
}
