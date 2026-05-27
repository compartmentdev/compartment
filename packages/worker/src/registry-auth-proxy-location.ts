const malformedPercentEncodingPattern: RegExp = /%(?![0-9A-Fa-f]{2})/u;
const absoluteUrlPattern: RegExp = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;

interface AbsoluteUrlAuthorityParts {
  authority: string;
  originFormLocation: string;
}

export function rewriteRegistryLocationHeader(location: string, targetUrl: URL): string | null {
  if (hasUnsafeRegistryLocationValue(location)) {
    return null;
  }

  if (isOriginFormLocation(location)) {
    return parseSafeRegistryOriginFormPath(location, targetUrl);
  }

  const originFormLocation: string | null = parseRegistryOriginAbsoluteLocation(location, targetUrl);
  if (originFormLocation === null) {
    return null;
  }

  return parseSafeRegistryOriginFormPath(originFormLocation, targetUrl);
}

function parseRegistryOriginAbsoluteLocation(location: string, targetUrl: URL): string | null {
  if (!absoluteUrlPattern.test(location)) {
    return null;
  }

  const authorityParts: AbsoluteUrlAuthorityParts = readAbsoluteUrlAuthorityParts(location);
  if (authorityParts.authority.includes('@')) {
    return null;
  }

  let parsedLocation: URL;
  try {
    parsedLocation = new URL(location);
  } catch {
    return null;
  }

  if (parsedLocation.username !== '' || parsedLocation.password !== '' || parsedLocation.origin !== targetUrl.origin) {
    return null;
  }

  return authorityParts.originFormLocation;
}

function parseSafeRegistryOriginFormPath(location: string, targetUrl: URL): string | null {
  if (!isOriginFormLocation(location) || hasUnsafeRegistryLocationValue(location)) {
    return null;
  }

  let parsedLocation: URL;
  try {
    parsedLocation = new URL(location, targetUrl);
  } catch {
    return null;
  }

  const pathname: string = readLocationPathname(location);
  if (
    parsedLocation.origin !== targetUrl.origin ||
    parsedLocation.pathname !== pathname ||
    !isRegistryApiPath(parsedLocation.pathname)
  ) {
    return null;
  }

  return location;
}

function readLocationPathname(location: string): string {
  const queryIndex: number = location.indexOf('?');
  const hashIndex: number = location.indexOf('#');
  let pathnameEndIndex: number = queryIndex;
  if (pathnameEndIndex === -1 || (hashIndex !== -1 && hashIndex < pathnameEndIndex)) {
    pathnameEndIndex = hashIndex;
  }

  return pathnameEndIndex === -1 ? location : location.slice(0, pathnameEndIndex);
}

function readAbsoluteUrlAuthorityParts(location: string): AbsoluteUrlAuthorityParts {
  const authorityStartIndex: number = location.indexOf('://') + 3;
  const authoritySuffix: string = location.slice(authorityStartIndex);
  const pathStartOffset: number = authoritySuffix.search(/[/?#]/u);
  if (pathStartOffset === -1) {
    return {
      authority: authoritySuffix,
      originFormLocation: '',
    };
  }

  return {
    authority: authoritySuffix.slice(0, pathStartOffset),
    originFormLocation: location.slice(authorityStartIndex + pathStartOffset),
  };
}

function isOriginFormLocation(location: string): boolean {
  return location.startsWith('/') && !location.startsWith('//');
}

function isRegistryApiPath(pathname: string): boolean {
  return pathname === '/v2' || pathname.startsWith('/v2/');
}

function hasUnsafeRegistryLocationValue(location: string): boolean {
  if (malformedPercentEncodingPattern.test(location)) {
    return true;
  }

  for (const character of location) {
    const characterCode: number = character.charCodeAt(0);
    if (character === '\\' || characterCode <= 32 || (characterCode >= 127 && characterCode <= 159)) {
      return true;
    }
  }

  return false;
}
