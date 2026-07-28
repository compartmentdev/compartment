const manifestDigestPattern: RegExp = /^sha256:[a-f0-9]{64}$/u;
const manifestTagPattern: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export function isManifestReference(value: string): boolean {
  return manifestTagPattern.test(value) || isManifestDigest(value);
}

export function isManifestDigest(value: string): boolean {
  return manifestDigestPattern.test(value);
}
