import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { JsonValue } from '@compartment/utils';

interface CreateSourceSyncClaimTokenInput {
  claimedAt: Date;
  claimedByWorkerId: string;
  secret: string;
}

export interface ParsedSourceSyncClaimToken {
  claimedAt: Date;
  claimedByWorkerId: string;
}

interface SourceSyncClaimTokenPayload {
  claimedAt: string;
  claimedByWorkerId: string;
  version: 1;
}

interface SerializedSourceSyncClaimToken extends SourceSyncClaimTokenPayload {
  signature: string;
}

export function createSourceSyncClaimToken(input: CreateSourceSyncClaimTokenInput): string {
  const payload: SourceSyncClaimTokenPayload = {
    claimedAt: input.claimedAt.toISOString(),
    claimedByWorkerId: input.claimedByWorkerId,
    version: 1,
  };
  const token: SerializedSourceSyncClaimToken = {
    ...payload,
    signature: signSourceSyncClaimTokenPayload(payload, input.secret),
  };

  return Buffer.from(JSON.stringify(token), 'utf8').toString('base64url');
}

export function parseSourceSyncClaimToken(claimToken: string, secret: string): ParsedSourceSyncClaimToken | null {
  const payload: SerializedSourceSyncClaimToken | null = parseSourceSyncClaimTokenPayload(claimToken);
  if (payload === null) {
    return null;
  }
  if (!isSourceSyncClaimTokenSignatureValid(payload, secret)) {
    return null;
  }

  const claimedAt: Date = new Date(payload.claimedAt);
  if (Number.isNaN(claimedAt.getTime())) {
    return null;
  }

  return {
    claimedAt,
    claimedByWorkerId: payload.claimedByWorkerId,
  };
}

function parseSourceSyncClaimTokenPayload(claimToken: string): SerializedSourceSyncClaimToken | null {
  try {
    const payload: JsonValue = JSON.parse(Buffer.from(claimToken, 'base64url').toString('utf8')) as JsonValue;
    return readSerializedSourceSyncClaimToken(payload);
  } catch {
    return null;
  }
}

function readSerializedSourceSyncClaimToken(value: JsonValue): SerializedSourceSyncClaimToken | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  if (
    value.version !== 1 ||
    typeof value.claimedByWorkerId !== 'string' ||
    value.claimedByWorkerId.length === 0 ||
    typeof value.claimedAt !== 'string' ||
    value.claimedAt.length === 0 ||
    typeof value.signature !== 'string' ||
    value.signature.length === 0
  ) {
    return null;
  }

  return {
    claimedAt: value.claimedAt,
    claimedByWorkerId: value.claimedByWorkerId,
    signature: value.signature,
    version: 1,
  };
}

function isSourceSyncClaimTokenSignatureValid(token: SerializedSourceSyncClaimToken, secret: string): boolean {
  const expectedSignature: string = signSourceSyncClaimTokenPayload(token, secret);
  const expectedBuffer: Buffer = Buffer.from(expectedSignature, 'hex');
  const actualBuffer: Buffer = Buffer.from(token.signature, 'hex');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function signSourceSyncClaimTokenPayload(payload: SourceSyncClaimTokenPayload, secret: string): string {
  return createHmac('sha256', secret).update(serializeSourceSyncClaimTokenPayload(payload), 'utf8').digest('hex');
}

function serializeSourceSyncClaimTokenPayload(payload: SourceSyncClaimTokenPayload): string {
  return `${payload.version}
${payload.claimedByWorkerId}
${payload.claimedAt}`;
}
