import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CreateCustomDomainRequest,
  CreateCustomDomainResponse,
  CustomDomainCheckStatus,
  CustomDomainResponse,
  CustomDomainState,
  CustomDomainSummary,
  ListCustomDomainsResponse,
  RemoveCustomDomainResponse,
  VerifyCustomDomainResponse,
} from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandResult,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  readCliStdout,
  runCliCommand,
} from './cli-test.harness';

type FetchInput = string | URL | Request;

describe.sequential('compartment domain commands', (): void => {
  let configDirectory: string;
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(async (): Promise<void> => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'compartment-domain-'));
    configDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-config-'));
    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
    await writeCliConfig(configDirectory);
  });

  afterEach(async (): Promise<void> => {
    process.chdir(originalCwd);
    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    vi.unstubAllGlobals();
    await rm(tempRoot, { force: true, recursive: true });
    await rm(configDirectory, { force: true, recursive: true });
  });

  it('adds a domain for the current repo project and prints DNS instructions', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    const fetchMock: Mock<typeof fetch> = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createJsonResponse(createCustomDomainResponse('pending')));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['domain', 'add', 'app.customer.example.com']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Custom domain app.customer.example.com is pending.');
    expect(readCliStdout(result.capture)).toContain('- TXT _compartment-domain.app.customer.example.com ->');
    expect(readCliStdout(result.capture)).toContain('- CNAME app.customer.example.com -> smoke-web.example.test');
    expect(readRequestBody(fetchMock)).toMatchObject({
      host: 'app.customer.example.com',
      projectName: 'smoke-web',
      serviceName: 'web',
    });
  });

  it('prints provider-neutral apex routing instructions for apex hosts', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    const fetchMock: Mock<typeof fetch> = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createJsonResponse(createApexCustomDomainResponse('pending')));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['domain', 'add', 'example.com']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain(
      '- Root domain example.com -> smoke-web.example.test (Cloudflare: CNAME @, DNS only; others: ALIAS/ANAME)',
    );
    expect(readRequestBody(fetchMock)).toMatchObject({
      host: 'example.com',
      projectName: 'smoke-web',
      serviceName: 'web',
    });
  });

  it('prints verification diagnostics and exits non-zero while DNS is not ready', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          createJsonResponse(
            createVerifyCustomDomainResponse('failed', 'CNAME does not point to the canonical route.'),
          ),
        ),
    );

    const result: CliCommandResult = await runCliCommand(['domain', 'verify', 'app.customer.example.com']);

    expectCliFailure(result, 'CNAME does not point to the canonical route.');
    expect(readCliStdout(result.capture)).toContain('Custom domain app.customer.example.com is failed.');
    expect(readCliStdout(result.capture)).toContain('Ownership: valid');
    expect(readCliStdout(result.capture)).toContain('Routing: invalid');
    expect(readCliStderr(result.capture)).toContain('CNAME does not point to the canonical route.');
    expect(
      countOccurrences(
        `${readCliStdout(result.capture)}${readCliStderr(result.capture)}`,
        'CNAME does not point to the canonical route.',
      ),
    ).toBe(1);
  });

  it('surfaces the public HTTPS port preflight failure when domain add is unsupported on a non-443 ingress', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          createErrorResponse('invalid_custom_domain', 'Custom domains require public HTTPS on port 443.'),
        ),
    );
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['domain', 'add', 'app.customer.example.com']);

    expectCliFailure(result, 'Custom domains require public HTTPS on port 443.');
    expect(readCliStderr(result.capture)).toContain('Custom domains require public HTTPS on port 443.');
  });

  it('surfaces the missing public ingress IP preflight failure when managed custom domains cannot be activated', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          createErrorResponse(
            'invalid_custom_domain',
            'Managed custom app domains require a public ingress IPv4 or IPv6 address.',
          ),
        ),
    );
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['domain', 'add', 'app.customer.example.com']);

    expectCliFailure(result, 'Managed custom app domains require a public ingress IPv4 or IPv6 address.');
    expect(readCliStderr(result.capture)).toContain(
      'Managed custom app domains require a public ingress IPv4 or IPv6 address.',
    );
  });

  it('lists domains for the current repo project by default', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({
        domains: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['domain', 'list']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('No custom domains found.');
    expect(readRequestUrl(fetchMock)).toContain('/v1/domains?projectName=smoke-web');
  });

  it('lists non-empty domains as text output', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({
        domains: [createCustomDomainSummary('ready', null)],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['domain', 'list']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('app.customer.example.com (ready)');
    expect(readCliStdout(result.capture)).toContain('Project: smoke-web');
    expect(readCliStdout(result.capture)).toContain('Canonical route: smoke-web.example.test');
  });

  it('shows a domain as json output', async (): Promise<void> => {
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({
        domain: createCustomDomainSummary('ready', null),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result: CliCommandResult = await runCliCommand([
      'domain',
      'show',
      'app.customer.example.com',
      '--output',
      'json',
    ]);

    expectCliSuccess(result);
    expect(JSON.parse(readCliStdout(result.capture))).toMatchObject({
      domain: {
        host: 'app.customer.example.com',
        status: 'ready',
      },
    });
    expect(readRequestUrl(fetchMock)).toContain('/v1/domains/app.customer.example.com');
  });

  it('shows a domain as text output', async (): Promise<void> => {
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({
        domain: createCustomDomainSummary('ready', null),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result: CliCommandResult = await runCliCommand(['domain', 'show', 'app.customer.example.com']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('app.customer.example.com (ready)');
    expect(readCliStdout(result.capture)).toContain('Ownership: valid');
    expect(readCliStdout(result.capture)).toContain('Routing: valid');
  });

  it('renders add, list, verify, and remove as json output', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    const fetchMock: Mock<typeof fetch> = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createJsonResponse(createCustomDomainResponse('pending')))
      .mockResolvedValueOnce(
        createJsonResponse({
          domains: [createCustomDomainSummary('pending', null)],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse(createVerifyCustomDomainResponse('failed', 'Routing DNS records are not valid yet.')),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          host: 'app.customer.example.com',
          removed: true,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const addResult: CliCommandResult = await runCliCommand([
      'domain',
      'add',
      'app.customer.example.com',
      '--output',
      'json',
    ]);
    const listResult: CliCommandResult = await runCliCommand(['domain', 'list', '--output', 'json']);
    const verifyResult: CliCommandResult = await runCliCommand([
      'domain',
      'verify',
      'app.customer.example.com',
      '--output',
      'json',
    ]);
    const removeResult: CliCommandResult = await runCliCommand([
      'domain',
      'remove',
      'app.customer.example.com',
      '--output',
      'json',
    ]);

    expectCliSuccess(addResult);
    expect(JSON.parse(readCliStdout(addResult.capture))).toMatchObject({
      dnsRecords: [{ recordType: 'TXT' }, { recordType: 'CNAME' }],
      domain: { host: 'app.customer.example.com', status: 'pending' },
    });
    expectCliSuccess(listResult);
    expect(JSON.parse(readCliStdout(listResult.capture))).toMatchObject({
      domains: [{ host: 'app.customer.example.com', status: 'pending' }],
    });
    expectCliFailure(verifyResult, 'Routing DNS records are not valid yet.');
    expect(JSON.parse(readCliStdout(verifyResult.capture))).toMatchObject({
      domain: { failureMessage: 'Routing DNS records are not valid yet.', status: 'failed' },
    });
    expectCliSuccess(removeResult);
    expect(JSON.parse(readCliStdout(removeResult.capture))).toEqual({
      host: 'app.customer.example.com',
      removed: true,
    });
  });

  it('removes a domain', async (): Promise<void> => {
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({
        host: 'app.customer.example.com',
        removed: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result: CliCommandResult = await runCliCommand(['domain', 'remove', 'app.customer.example.com']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Removed custom domain app.customer.example.com.');
    expect(readRequestUrl(fetchMock)).toContain('/v1/domains/app.customer.example.com');
  });

  it('accepts project, environment, and service options for show, verify, and remove', async (): Promise<void> => {
    const fetchMock: Mock<typeof fetch> = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          domain: createCustomDomainSummary('ready', null),
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(createVerifyCustomDomainResponse('ready', null)))
      .mockResolvedValueOnce(
        createJsonResponse({
          host: 'app.customer.example.com',
          removed: true,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const targetOptions: string[] = ['--project', 'smoke-web', '--env', 'production', '--service', 'web'];

    const showResult: CliCommandResult = await runCliCommand([
      'domain',
      'show',
      'app.customer.example.com',
      ...targetOptions,
    ]);
    const verifyResult: CliCommandResult = await runCliCommand([
      'domain',
      'verify',
      'app.customer.example.com',
      ...targetOptions,
    ]);
    const removeResult: CliCommandResult = await runCliCommand([
      'domain',
      'remove',
      'app.customer.example.com',
      ...targetOptions,
    ]);

    expectCliSuccess(showResult);
    expectCliSuccess(verifyResult);
    expectCliSuccess(removeResult);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('requires --service when the current project has multiple services', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web', ['web', 'worker']);
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand(['domain', 'add', 'app.customer.example.com']);

    expectCliFailure(result, 'Service is required for custom domains. Pass --service <name>.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires --service when --project targets a different project than the current repo', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web');
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'domain',
      'add',
      'app.customer.example.com',
      '--project',
      'billing',
    ]);

    expectCliFailure(result, 'Service is required for custom domains. Pass --service <name>.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds a domain for an explicit project and service outside the current repo project', async (): Promise<void> => {
    const projectDirectory: string = await createProjectDirectory(tempRoot, 'smoke-web', ['local-web']);
    const fetchMock: Mock<typeof fetch> = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createJsonResponse(createCustomDomainResponse('pending')));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectDirectory);

    const result: CliCommandResult = await runCliCommand([
      'domain',
      'add',
      'app.customer.example.com',
      '--project',
      'billing',
      '--service',
      'web',
    ]);

    expectCliSuccess(result);
    expect(readRequestBody(fetchMock)).toMatchObject({
      host: 'app.customer.example.com',
      projectName: 'billing',
      serviceName: 'web',
    });
  });
});

async function writeCliConfig(configDirectory: string): Promise<void> {
  await writeFile(
    join(configDirectory, 'config.json'),
    `${JSON.stringify(createCliConfigFixture(), null, 2)}\n`,
    'utf8',
  );
}

async function createProjectDirectory(
  tempRoot: string,
  projectName: string,
  serviceNames: readonly string[] = ['web'],
): Promise<string> {
  const projectDirectory: string = join(tempRoot, projectName);
  await mkdir(projectDirectory);
  await writeFile(
    join(projectDirectory, 'compartment.yml'),
    `name: ${projectName}\n\nservices:\n${serviceNames.map(renderServiceDescriptorLine).join('')}`,
    'utf8',
  );

  return projectDirectory;
}

function renderServiceDescriptorLine(serviceName: string): string {
  return `  ${serviceName}: .\n`;
}

type CustomDomainResponsePayload =
  | CreateCustomDomainResponse
  | CustomDomainResponse
  | ListCustomDomainsResponse
  | RemoveCustomDomainResponse
  | VerifyCustomDomainResponse;

function createJsonResponse(payload: CustomDomainResponsePayload): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
  });
}

function createErrorResponse(code: string, message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 400,
    },
  );
}

function readRequestBody(fetchMock: Mock<typeof fetch>): CreateCustomDomainRequest {
  const init: RequestInit = fetchMock.mock.calls[0]![1]!;
  if (typeof init.body !== 'string') {
    throw new Error('Expected string request body.');
  }

  return JSON.parse(init.body) as CreateCustomDomainRequest;
}

function readRequestUrl(fetchMock: Mock<typeof fetch>): string {
  const input: FetchInput = fetchMock.mock.calls[0]![0];
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof Request) {
    return input.url;
  }

  return input.toString();
}

function countOccurrences(value: string, searchValue: string): number {
  return value.split(searchValue).length - 1;
}

function createCustomDomainResponse(status: CustomDomainState): CreateCustomDomainResponse {
  return {
    dnsRecords: [
      {
        groupId: 'ownership',
        name: '_compartment-domain.app.customer.example.com',
        purpose: 'ownership',
        recordType: 'TXT',
        required: true,
        value: 'compartment-domain-verification=cdom_123',
      },
      {
        groupId: 'routing',
        name: 'app.customer.example.com',
        purpose: 'routing',
        recordType: 'CNAME',
        required: true,
        value: 'smoke-web.example.test',
      },
    ],
    domain: createCustomDomainSummary(status, null),
  };
}

function createVerifyCustomDomainResponse(
  status: CustomDomainState,
  failureMessage: string | null,
): VerifyCustomDomainResponse {
  return {
    dnsRecords: createCustomDomainResponse(status).dnsRecords,
    domain: createCustomDomainSummary(status, failureMessage),
  };
}

function createApexCustomDomainResponse(status: CustomDomainState): CreateCustomDomainResponse {
  return {
    dnsRecords: [
      {
        groupId: 'ownership',
        name: '_compartment-domain.example.com',
        purpose: 'ownership',
        recordType: 'TXT',
        required: true,
        value: 'compartment-domain-verification=cdom_456',
      },
      {
        groupId: 'routing',
        name: 'example.com',
        purpose: 'routing',
        recordType: 'APEX_ALIAS',
        required: false,
        value: 'smoke-web.example.test',
      },
    ],
    domain: {
      ...createCustomDomainSummary(status, null),
      host: 'example.com',
    },
  };
}

function createCustomDomainSummary(status: CustomDomainState, failureMessage: string | null): CustomDomainSummary {
  return {
    canonicalRouteHost: 'smoke-web.example.test',
    createdAt: '2026-04-23T00:00:00.000Z',
    environmentName: 'production',
    failureMessage,
    host: 'app.customer.example.com',
    lastCheckedAt: null,
    ownershipStatus: readOwnershipStatus(status),
    projectName: 'smoke-web',
    routingStatus: readRoutingStatus(status),
    serviceName: 'web',
    status,
    updatedAt: '2026-04-23T00:00:00.000Z',
    verifiedAt: status === 'ready' ? '2026-04-23T00:01:00.000Z' : null,
  };
}

function readOwnershipStatus(status: CustomDomainState): CustomDomainCheckStatus {
  if (status === 'ready') {
    return 'valid';
  }
  if (status === 'failed') {
    return 'valid';
  }

  return 'pending';
}

function readRoutingStatus(status: CustomDomainState): CustomDomainCheckStatus {
  if (status === 'ready') {
    return 'valid';
  }
  if (status === 'failed') {
    return 'invalid';
  }

  return 'pending';
}
