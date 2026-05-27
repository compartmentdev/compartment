const bearerPrefix: string = 'Bearer ';
const validationHeaderName: string = 'Compartment-Validation';

export function assertHttpHeaderName(value: string, label: string): void {
  assertPlatformHeaderAccepts(value, '', label);
}

export function assertHttpHeaderValue(value: string, label: string): void {
  if (hasUnsafeHttpHeaderControl(value)) {
    throwInvalidHttpHeaderInput(label);
  }

  assertPlatformHeaderAccepts(validationHeaderName, value, label);
}

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

function hasUnsafeHttpHeaderControl(value: string): boolean {
  // The platform Headers parser permits HTAB; this package treats all C0 controls as unsafe serialization input.
  for (let index: number = 0; index < value.length; index += 1) {
    const charCode: number = value.charCodeAt(index);
    if (charCode <= 0x1f || charCode === 0x7f) {
      return true;
    }
  }

  return false;
}

function assertPlatformHeaderAccepts(name: string, value: string, label: string): void {
  try {
    new Headers([[name, value]]);
  } catch {
    throwInvalidHttpHeaderInput(label);
  }
}

function throwInvalidHttpHeaderInput(label: string): never {
  throw new Error(`Invalid ${label}.`);
}
