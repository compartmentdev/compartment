const malformedPercentEncodingPattern: RegExp = /%(?![0-9A-Fa-f]{2})/u;
const absoluteUrlPattern: RegExp = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;

export function rewriteRegistryLocationHeader(location: string, targetUrl: URL): string | null {
  if (hasUnsafeRegistryLocationValue(location)) {
    return null;
  }

  if (isOriginFormLocation(location)) {
    return parseSafeRegistryOriginFormPath(location, targetUrl);
  }

  const parsedLocation: URL | null = parseRegistryOriginAbsoluteLocation(location, targetUrl);
  if (parsedLocation === null) {
    return null;
  }

  return parseSafeRegistryOriginFormPath(
    `${parsedLocation.pathname}${parsedLocation.search}${parsedLocation.hash}`,
    targetUrl,
  );
}

function parseRegistryOriginAbsoluteLocation(location: string, targetUrl: URL): URL | null {
  if (!absoluteUrlPattern.test(location)) {
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

  return parsedLocation;
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
