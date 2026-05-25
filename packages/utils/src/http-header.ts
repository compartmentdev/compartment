const bearerPrefix: string = 'Bearer ';

export function readBearerToken(authorizationHeader: string | string[] | undefined): string | undefined {
  const headerValue: string | undefined = readHeaderValue(authorizationHeader);
  if (typeof headerValue !== 'string' || !headerValue.startsWith(bearerPrefix)) {
    return undefined;
  }

  return headerValue.slice(bearerPrefix.length);
}

export function readHeaderValue(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
}
