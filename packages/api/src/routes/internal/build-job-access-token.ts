import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { JsonValue } from '@compartment/utils';

const tokenLifetimeMs: number = 60 * 60 * 1000;

export interface BuildJobAccessTokenClaims {
  artifactId: string;
  deploymentId: string;
  expiresAt: string;
}

interface BuildJobAccessTokenPayload extends BuildJobAccessTokenClaims {
  version: 1;
}

interface SignedBuildJobAccessToken extends BuildJobAccessTokenPayload {
  signature: string;
}

interface CreateBuildJobAccessTokenInput {
  artifactId: string;
  deploymentId: string;
  now?: Date;
  secret: string;
}

export function createBuildJobAccessToken(input: CreateBuildJobAccessTokenInput): string {
  const now: Date = input.now ?? new Date();
  const payload: BuildJobAccessTokenPayload = {
    artifactId: input.artifactId,
    deploymentId: input.deploymentId,
    expiresAt: new Date(now.getTime() + tokenLifetimeMs).toISOString(),
    version: 1,
  };
  return Buffer.from(JSON.stringify({ ...payload, signature: sign(payload, input.secret) }), 'utf8').toString(
    'base64url',
  );
}

export function parseBuildJobAccessToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): BuildJobAccessTokenClaims | null {
  const parsed: SignedBuildJobAccessToken | null = parseToken(token);
  if (parsed === null || new Date(parsed.expiresAt).getTime() < now.getTime()) {
    return null;
  }
  const expected: Buffer = Buffer.from(sign(parsed, secret), 'hex');
  const actual: Buffer = Buffer.from(parsed.signature, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  return { artifactId: parsed.artifactId, deploymentId: parsed.deploymentId, expiresAt: parsed.expiresAt };
}

function parseToken(token: string): SignedBuildJobAccessToken | null {
  try {
    const value: JsonValue = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as JsonValue;
    const parsed: SignedBuildJobAccessToken | null = readSignedBuildJobAccessToken(value);
    if (parsed === null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readSignedBuildJobAccessToken(value: JsonValue): SignedBuildJobAccessToken | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    value.version === 1 &&
    typeof value.artifactId === 'string' &&
    value.artifactId.length > 0 &&
    typeof value.deploymentId === 'string' &&
    value.deploymentId.length > 0 &&
    typeof value.expiresAt === 'string' &&
    Number.isFinite(new Date(value.expiresAt).getTime()) &&
    typeof value.signature === 'string' &&
    value.signature.length > 0
  ) {
    return {
      artifactId: value.artifactId,
      deploymentId: value.deploymentId,
      expiresAt: value.expiresAt,
      signature: value.signature,
      version: 1,
    };
  }
  return null;
}

function sign(payload: BuildJobAccessTokenPayload, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${payload.version}\n${payload.artifactId}\n${payload.deploymentId}\n${payload.expiresAt}`, 'utf8')
    .digest('hex');
}
