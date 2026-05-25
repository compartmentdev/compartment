export function buildCompartmentResourceHostname(
  projectName: string,
  environmentName: string,
  resourceName: string,
): string {
  return [
    encodeResourceHostnameSegment(resourceName),
    encodeResourceHostnameSegment(environmentName),
    encodeResourceHostnameSegment(projectName),
    'resource',
    'internal',
  ].join('.');
}

function encodeResourceHostnameSegment(value: string): string {
  const encoded: string = value.toLowerCase().split('').map(encodeResourceHostnameCharacter).join('');
  const dnsLabel: string = encoded.replace(/^-+|-+$/gu, '');
  const label: string = dnsLabel === '' ? 'x' : dnsLabel;
  if (label.length <= 63) {
    return label;
  }

  const hash: string = createStableHostnameHash(label);
  return `${label.slice(0, 63 - hash.length - 1).replace(/-+$/gu, '')}-${hash}`;
}

function encodeResourceHostnameCharacter(character: string): string {
  if (/^[a-z0-9-]$/u.test(character)) {
    return character;
  }

  return `x${readCharacterCodePoint(character).toString(16)}x`;
}

function createStableHostnameHash(value: string): string {
  let hash: number = 0;
  for (const character of value) {
    hash = (hash * 31 + readCharacterCodePoint(character)) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function readCharacterCodePoint(character: string): number {
  const codePoint: number | undefined = character.codePointAt(0);
  if (codePoint === undefined) {
    throw new Error('Expected a resource hostname character.');
  }

  return codePoint;
}
