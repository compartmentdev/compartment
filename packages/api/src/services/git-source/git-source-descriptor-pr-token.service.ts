import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GitDescriptorPullRequestStatusRequest, GitDescriptorPullRequestResponse } from '@compartment/contracts';
import { createGitSourceRequestInvalidError } from '../../errors/api-business-error';
import { getApiConfig } from '../../runtime/runtime-access';

interface GitDescriptorPullRequestStatusTokenInput {
  providerHost: string;
  pullRequestNumber: number;
  registrationId: string;
  repositoryName: string;
  repositoryOwner: string;
}

interface GitDescriptorPullRequestStatusTokenPayload extends GitDescriptorPullRequestStatusTokenInput {
  version: 1;
}

interface ParsedGitDescriptorPullRequestStatusToken {
  payload: GitDescriptorPullRequestStatusTokenPayload;
  payloadText: string;
  signature: string;
}

interface ParsedGitDescriptorPullRequestStatusTokenPayload {
  providerHost?: string;
  pullRequestNumber?: number;
  registrationId?: string;
  repositoryName?: string;
  repositoryOwner?: string;
  version?: number;
}

export function withGitDescriptorPullRequestStatusToken(
  input: GitDescriptorPullRequestStatusTokenInput,
  response: Omit<GitDescriptorPullRequestResponse, 'statusToken'>,
): GitDescriptorPullRequestResponse {
  return {
    ...response,
    statusToken: createGitDescriptorPullRequestStatusToken(input),
  };
}

function createGitDescriptorPullRequestStatusToken(input: GitDescriptorPullRequestStatusTokenInput): string {
  const payload: GitDescriptorPullRequestStatusTokenPayload = {
    providerHost: input.providerHost,
    pullRequestNumber: input.pullRequestNumber,
    registrationId: input.registrationId,
    repositoryName: input.repositoryName,
    repositoryOwner: input.repositoryOwner,
    version: 1,
  };
  const payloadText: string = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadText}.${signGitDescriptorPullRequestStatusTokenPayload(payloadText)}`;
}

export function assertGitDescriptorPullRequestStatusToken(input: GitDescriptorPullRequestStatusRequest): void {
  const parsed: ParsedGitDescriptorPullRequestStatusToken = parseGitDescriptorPullRequestStatusToken(input.statusToken);
  if (!isExpectedGitDescriptorPullRequestStatusTokenSignature(parsed)) {
    throw createGitSourceRequestInvalidError('Git descriptor pull request status token is invalid.');
  }
  if (!doesGitDescriptorPullRequestStatusTokenMatchRequest(parsed.payload, input)) {
    throw createGitSourceRequestInvalidError('Git descriptor pull request status token does not match the request.');
  }
}

function parseGitDescriptorPullRequestStatusToken(value: string): ParsedGitDescriptorPullRequestStatusToken {
  const [payloadText, signature, extra]: string[] = value.split('.');
  if (payloadText === undefined || signature === undefined || extra !== undefined) {
    throw createGitSourceRequestInvalidError('Git descriptor pull request status token is invalid.');
  }

  let parsed: ParsedGitDescriptorPullRequestStatusTokenPayload;
  try {
    parsed = JSON.parse(
      Buffer.from(payloadText, 'base64url').toString('utf8'),
    ) as ParsedGitDescriptorPullRequestStatusTokenPayload;
  } catch {
    throw createGitSourceRequestInvalidError('Git descriptor pull request status token is invalid.');
  }
  if (!isGitDescriptorPullRequestStatusTokenPayload(parsed)) {
    throw createGitSourceRequestInvalidError('Git descriptor pull request status token is invalid.');
  }

  return {
    payload: parsed,
    payloadText,
    signature,
  };
}

function isExpectedGitDescriptorPullRequestStatusTokenSignature(
  token: ParsedGitDescriptorPullRequestStatusToken,
): boolean {
  const expected: Buffer = Buffer.from(signGitDescriptorPullRequestStatusTokenPayload(token.payloadText), 'utf8');
  const actual: Buffer = Buffer.from(token.signature, 'utf8');
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

function signGitDescriptorPullRequestStatusTokenPayload(payloadText: string): string {
  return createHmac('sha256', getApiConfig().sessionSecret).update(payloadText).digest('base64url');
}

function isGitDescriptorPullRequestStatusTokenPayload(
  value: ParsedGitDescriptorPullRequestStatusTokenPayload,
): value is GitDescriptorPullRequestStatusTokenPayload {
  return (
    value.version === 1 &&
    typeof value.providerHost === 'string' &&
    typeof value.pullRequestNumber === 'number' &&
    Number.isInteger(value.pullRequestNumber) &&
    value.pullRequestNumber > 0 &&
    typeof value.registrationId === 'string' &&
    typeof value.repositoryName === 'string' &&
    typeof value.repositoryOwner === 'string'
  );
}

function doesGitDescriptorPullRequestStatusTokenMatchRequest(
  token: GitDescriptorPullRequestStatusTokenPayload,
  request: GitDescriptorPullRequestStatusRequest,
): boolean {
  return (
    token.providerHost === request.providerHost &&
    token.pullRequestNumber === request.pullRequestNumber &&
    token.registrationId === request.registrationId &&
    token.repositoryName === request.repositoryName &&
    token.repositoryOwner === request.repositoryOwner
  );
}
