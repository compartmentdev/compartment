import type { LookupAddress } from 'node:dns';
import { type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import type { GitHubAppManifestPlan } from '../src/services/git-source/github-app-client.adapter.types';
import { readGitHubAppManifestPlan } from '../src/services/git-source/github-app-bootstrap.adapter';
import { createSsoOidcApiConfig } from './sso-oidc/sso-oidc-login.service.fixtures';

type CreateHttpsRequest = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
type LookupDns = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;

interface ParsedGitHubManifest {
  name: string;
}

interface GitHubBootstrapLookupTestMocks {
  createHttpsRequest: Mock<CreateHttpsRequest>;
  lookupDns: Mock<LookupDns>;
}

const mocks: GitHubBootstrapLookupTestMocks = vi.hoisted(
  (): GitHubBootstrapLookupTestMocks => ({
    createHttpsRequest: vi.fn<CreateHttpsRequest>(),
    lookupDns: vi.fn<LookupDns>(),
  }),
);

vi.mock('node:https', (): { request: Mock<CreateHttpsRequest> } => ({
  request: mocks.createHttpsRequest,
}));

vi.mock('node:dns/promises', (): { lookup: Mock<LookupDns> } => ({
  lookup: mocks.lookupDns,
}));

beforeEach((): void => {
  mocks.createHttpsRequest.mockReset();
  mocks.lookupDns.mockReset();
  mocks.lookupDns.mockResolvedValue([
    { address: readExamplePublicIpv6Address(), family: 6 },
    { address: readExamplePublicAddress(), family: 4 },
  ]);
  configureRuntime();
});

afterEach((): void => {
  clearApiRuntime();
});

describe('GitHub App bootstrap trusted outbound lookup', (): void => {
  it('supports the Node all=true lookup callback shape during owner discovery', async (): Promise<void> => {
    mocks.createHttpsRequest.mockImplementationOnce(
      createMockLookupAllHttpsRequestImplementation([
        {
          address: readExamplePublicAddress(),
          family: 4,
        },
      ]),
    );

    const plan: GitHubAppManifestPlan = await readGitHubAppManifestPlan({
      callbackUrl: 'https://console.example.com/v1/sources/git/providers/github/callback',
      controlPlaneUrl: 'https://console.example.com',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
      setupUrl: 'https://console.example.com/v1/sources/git/providers/github/setup',
      webhookUrl: 'https://console.example.com/v1/sources/git/providers/github/webhook',
    });

    const manifest: ParsedGitHubManifest = JSON.parse(plan.manifestJson) as ParsedGitHubManifest;

    expect(plan.formActionUrl).toBe('https://github.com/settings/apps/new');
    expect(manifest.name).toBe('Compartment acme');
    expect(mocks.createHttpsRequest).toHaveBeenCalledTimes(1);
  });
});

function configureRuntime(): void {
  const config: ApiConfig = createSsoOidcApiConfig();
  configureApiRuntime({
    config,
    db: {} as Database,
  });
}

function readExamplePublicAddress(): string {
  return ['93', '184', '216', '34'].join('.');
}

function readExamplePublicIpv6Address(): string {
  return ['2606', '2800', '220', '1', '248', '1893', '25c8', '1946'].join(':');
}

function createMockLookupAllHttpsRequest(
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
  expectedAddresses: LookupAddress[],
): ClientRequest {
  const request: ClientRequest = new EventEmitter() as ClientRequest;
  request.destroy = vi.fn((): ClientRequest => request);
  request.end = vi.fn((): ClientRequest => {
    if (typeof options.hostname !== 'string' || options.lookup === undefined) {
      throw new Error('Expected GitHub outbound request options to include hostname and lookup.');
    }

    options.lookup(
      options.hostname,
      { all: true, family: 4 },
      (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family: number | undefined): void => {
        if (error !== null) {
          request.emit('error', error);
          return;
        }
        if (!Array.isArray(address) || family !== undefined) {
          request.emit('error', new Error('Expected lookup to return an address array for all=true.'));
          return;
        }

        expect(options.hostname).toBe('api.github.com');
        expect(address).toEqual(expectedAddresses);
        callback(createJsonResponse({ type: 'User' }));
      },
    );

    return request;
  }) as typeof request.end;

  return request;
}

function createMockLookupAllHttpsRequestImplementation(expectedAddresses: LookupAddress[]): CreateHttpsRequest {
  return (options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest =>
    createMockLookupAllHttpsRequest(options, callback, expectedAddresses);
}

function createJsonResponse(payload: object): IncomingMessage {
  const responseBody: Buffer = Buffer.from(JSON.stringify(payload));
  const response: Readable = Readable.from([responseBody]);
  return Object.assign(response, {
    headers: { 'content-type': 'application/json' },
    statusCode: 200,
    statusMessage: 'OK',
  }) as IncomingMessage;
}
