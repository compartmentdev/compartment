const bearerPrefix: string = 'Bearer ';

export function assertHttpHeaderName(value: string, label: string): void {
  if (value.length === 0) {
    throwInvalidHttpHeaderInput(label);
  }

  for (let index: number = 0; index < value.length; index += 1) {
    if (!isHttpTokenCharacter(value.charCodeAt(index))) {
      throwInvalidHttpHeaderInput(label);
    }
  }
}

export function assertHttpHeaderValue(value: string, label: string): void {
  for (let index: number = 0; index < value.length; index += 1) {
    if (isInvalidHttpHeaderValueCharacter(value.charCodeAt(index))) {
      throwInvalidHttpHeaderInput(label);
    }
  }
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

function isHttpTokenCharacter(charCode: number): boolean {
  return (
    charCode === 0x21 ||
    charCode === 0x23 ||
    charCode === 0x24 ||
    charCode === 0x25 ||
    charCode === 0x26 ||
    charCode === 0x27 ||
    charCode === 0x2a ||
    charCode === 0x2b ||
    charCode === 0x2d ||
    charCode === 0x2e ||
    charCode === 0x5e ||
    charCode === 0x5f ||
    charCode === 0x60 ||
    charCode === 0x7c ||
    charCode === 0x7e ||
    isAsciiDigit(charCode) ||
    isAsciiLetter(charCode)
  );
}

function isInvalidHttpHeaderValueCharacter(charCode: number): boolean {
  return charCode <= 0x1f || charCode === 0x7f || charCode > 0xff;
}

function isAsciiDigit(charCode: number): boolean {
  return charCode >= 0x30 && charCode <= 0x39;
}

function isAsciiLetter(charCode: number): boolean {
  return (charCode >= 0x41 && charCode <= 0x5a) || (charCode >= 0x61 && charCode <= 0x7a);
}

function throwInvalidHttpHeaderInput(label: string): never {
  throw new Error(`Invalid ${label}.`);
}
