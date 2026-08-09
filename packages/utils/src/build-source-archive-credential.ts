import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BuildSourceArchiveCredentialPayload } from './build-source-archive-credential.types';
import { hasText } from './text';

const credentialContext: string = 'compartment-build-source-archive-v1';
const credentialVersion: 1 = 1;

export function issueBuildSourceArchiveCredential(
  signingKey: string,
  artifactId: string,
  expiresAtSeconds: number,
): string {
  if (!hasText(artifactId)) {
    throw new Error('Build source archive credentials require an artifact id.');
  }
  if (!Number.isSafeInteger(expiresAtSeconds)) {
    throw new Error('Build source archive credentials require an integer expiry in seconds.');
  }
  const payload: BuildSourceArchiveCredentialPayload = {
    artifactId,
    expiresAt: expiresAtSeconds,
    version: credentialVersion,
  };
  const payloadText: string = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadText}.${signCredentialPayload(signingKey, payloadText)}`;
}

export function verifyBuildSourceArchiveCredential(
  signingKey: string,
  credential: string | undefined,
  artifactId: string,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
): boolean {
  const payload: BuildSourceArchiveCredentialPayload | null = readSignedCredentialPayload(signingKey, credential);
  return payload !== null && payload.artifactId === artifactId && payload.expiresAt >= nowSeconds;
}

function readSignedCredentialPayload(
  signingKey: string,
  credential: string | undefined,
): BuildSourceArchiveCredentialPayload | null {
  if (credential === undefined) {
    return null;
  }
  const [payloadText, signature, extra]: (string | undefined)[] = credential.split('.');
  if (payloadText === undefined || signature === undefined || extra !== undefined) {
    return null;
  }
  if (!isExpectedCredentialSignature(signingKey, payloadText, signature)) {
    return null;
  }
  return decodeCredentialPayload(payloadText);
}

function decodeCredentialPayload(payloadText: string): BuildSourceArchiveCredentialPayload | null {
  let parsed: Partial<BuildSourceArchiveCredentialPayload> | null;
  try {
    parsed = JSON.parse(
      Buffer.from(payloadText, 'base64url').toString('utf8'),
    ) as Partial<BuildSourceArchiveCredentialPayload> | null;
  } catch {
    return null;
  }
  return isCredentialPayload(parsed) ? parsed : null;
}

function isCredentialPayload(
  value: Partial<BuildSourceArchiveCredentialPayload> | null,
): value is BuildSourceArchiveCredentialPayload {
  return (
    value !== null &&
    value.version === credentialVersion &&
    typeof value.artifactId === 'string' &&
    value.artifactId !== '' &&
    typeof value.expiresAt === 'number' &&
    Number.isSafeInteger(value.expiresAt)
  );
}

function isExpectedCredentialSignature(signingKey: string, payloadText: string, signature: string): boolean {
  const expected: Buffer = Buffer.from(signCredentialPayload(signingKey, payloadText), 'utf8');
  const actual: Buffer = Buffer.from(signature, 'utf8');
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

function signCredentialPayload(signingKey: string, payloadText: string): string {
  return createHmac('sha256', deriveCredentialSigningKey(signingKey)).update(payloadText).digest('base64url');
}

function deriveCredentialSigningKey(signingKey: string): Buffer {
  return createHmac('sha256', signingKey).update(credentialContext).digest();
}
