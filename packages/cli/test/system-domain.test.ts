import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SystemDomainMutationResponse, SystemDomainStatusResponse } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as SelfHostedInstallPathsSourceModule from '../src/self-hosted-install-paths';
import type { SystemDomainApiRequest, SystemDomainClientConfig } from '../src/system-domain-client.types';

type PendingSystemDomainStatusRequest = SystemDomainApiRequest<SystemDomainStatusResponse> & { method: 'GET' };
type AttachSystemDomainCertificateRequest = SystemDomainApiRequest<SystemDomainMutationResponse> & { method: 'POST' };
type PendingAttachFlowRequest = PendingSystemDomainStatusRequest | AttachSystemDomainCertificateRequest;

type RequestSystemDomainApi = (
  config: SystemDomainClientConfig,
  input: PendingAttachFlowRequest,
) => Promise<SystemDomainMutationResponse | SystemDomainStatusResponse>;

interface TemporaryInstallPaths {
  configDir: string;
  customTlsDirectory: string;
  dataDir: string;
}

describe.sequential('system domain attach flow', (): void => {
  const temporaryDirectories: string[] = [];
  const requestSystemDomainApiMock: Mock<RequestSystemDomainApi> = vi.fn<RequestSystemDomainApi>();

  beforeEach((): void => {
    vi.resetModules();
    requestSystemDomainApiMock.mockReset();
  });

  afterEach(async (): Promise<void> => {
    vi.doUnmock('../src/self-hosted-install-paths');
    vi.doUnmock('../src/self-hosted-system-privileges');
    vi.doUnmock('../src/system-domain-client');
    await Promise.all(
      temporaryDirectories.map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
    temporaryDirectories.length = 0;
  });

  it('stages attach-cert PEM files into the canonical TLS directory and posts a version-only body', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeInstallFiles(installPaths);
    const certificateFile: string = join(installPaths.dataDir, 'source-cert.pem');
    const privateKeyFile: string = join(installPaths.dataDir, 'source-key.pem');
    await writeFile(certificateFile, 'CERTIFICATE-A\n', 'utf8');
    await writeFile(privateKeyFile, 'PRIVATE-KEY-A\n', 'utf8');
    mockSystemPrivileges();
    mockSelfHostedPathSelection(installPaths);
    mockSystemDomainApi(requestSystemDomainApiMock);
    requestSystemDomainApiMock.mockImplementation(mockPendingAttachFlowRequest);
    const { attachSelfHostedSystemDomainCertificate } = await import('../src/system-domain');

    await attachSelfHostedSystemDomainCertificate({
      certificateFile,
      privateKeyFile,
    });

    expect(await readFile(join(installPaths.customTlsDirectory, 'domop_123', 'fullchain.pem'), 'utf8')).toBe(
      'CERTIFICATE-A\n',
    );
    expect(await readFile(join(installPaths.customTlsDirectory, 'domop_123', 'privkey.pem'), 'utf8')).toBe(
      'PRIVATE-KEY-A\n',
    );
    expect(requestSystemDomainApiMock.mock.calls[1]?.[1]).toMatchObject({
      body: { expectedSetupVersion: 7 },
      method: 'POST',
      path: '/internal/system/domain/attach-cert',
    });
  });

  it('changes the attach-cert idempotency key when the staged PEM content changes', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeInstallFiles(installPaths);
    const certificateFile: string = join(installPaths.dataDir, 'source-cert.pem');
    const privateKeyFile: string = join(installPaths.dataDir, 'source-key.pem');
    mockSystemPrivileges();
    mockSelfHostedPathSelection(installPaths);
    mockSystemDomainApi(requestSystemDomainApiMock);
    requestSystemDomainApiMock.mockImplementation(mockPendingAttachFlowRequest);
    const { attachSelfHostedSystemDomainCertificate } = await import('../src/system-domain');

    await writeFile(certificateFile, 'CERTIFICATE-A\n', 'utf8');
    await writeFile(privateKeyFile, 'PRIVATE-KEY-A\n', 'utf8');
    await attachSelfHostedSystemDomainCertificate({ certificateFile, privateKeyFile });
    const firstIdempotencyKey: string | undefined = requestSystemDomainApiMock.mock.calls[1]?.[1].idempotencyKey;

    await writeFile(certificateFile, 'CERTIFICATE-B\n', 'utf8');
    await writeFile(privateKeyFile, 'PRIVATE-KEY-B\n', 'utf8');
    await attachSelfHostedSystemDomainCertificate({ certificateFile, privateKeyFile });
    const secondIdempotencyKey: string | undefined = requestSystemDomainApiMock.mock.calls[3]?.[1].idempotencyKey;

    expect(firstIdempotencyKey).toBeTruthy();
    expect(secondIdempotencyKey).toBeTruthy();
    expect(secondIdempotencyKey).not.toBe(firstIdempotencyKey);
  });

  it('rejects attach-cert when the TLS directory is still runtime-writable', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths(temporaryDirectories);
    await writeInstallFiles(installPaths);
    await chmod(installPaths.customTlsDirectory, 0o777);
    const certificateFile: string = join(installPaths.dataDir, 'source-cert.pem');
    const privateKeyFile: string = join(installPaths.dataDir, 'source-key.pem');
    await writeFile(certificateFile, 'CERTIFICATE-A\n', 'utf8');
    await writeFile(privateKeyFile, 'PRIVATE-KEY-A\n', 'utf8');
    mockSystemPrivileges();
    mockSelfHostedPathSelection(installPaths);
    mockSystemDomainApi(requestSystemDomainApiMock);
    requestSystemDomainApiMock.mockImplementation(mockPendingAttachFlowRequest);
    const { attachSelfHostedSystemDomainCertificate } = await import('../src/system-domain');

    await expect(attachSelfHostedSystemDomainCertificate({ certificateFile, privateKeyFile })).rejects.toThrow(
      'Run `sudo compartment system restart` before attaching a custom certificate.',
    );
  });
});

async function createTemporaryInstallPaths(temporaryDirectories: string[]): Promise<TemporaryInstallPaths> {
  const temporaryDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-system-domain-'));
  temporaryDirectories.push(temporaryDirectory);

  return {
    configDir: join(temporaryDirectory, 'etc'),
    customTlsDirectory: join(temporaryDirectory, 'tls'),
    dataDir: join(temporaryDirectory, 'var'),
  };
}

function mockSelfHostedPathSelection(installPaths: TemporaryInstallPaths): void {
  vi.doMock(
    '../src/self-hosted-install-paths',
    async (
      importOriginal: () => Promise<typeof SelfHostedInstallPathsSourceModule>,
    ): Promise<typeof SelfHostedInstallPathsSourceModule> => {
      const actualModule: typeof SelfHostedInstallPathsSourceModule = await importOriginal();
      return {
        ...actualModule,
        buildSelfHostedPathSelection: vi.fn((): { configDir: string; dataDir: string } => ({
          configDir: installPaths.configDir,
          dataDir: installPaths.dataDir,
        })),
      };
    },
  );
}

function mockSystemPrivileges(): void {
  vi.doMock('../src/self-hosted-system-privileges', (): { assertSelfHostedSystemPrivileges: () => void } => ({
    assertSelfHostedSystemPrivileges: vi.fn<() => void>(),
  }));
}

function mockSystemDomainApi(requestMock: Mock<RequestSystemDomainApi>): void {
  vi.doMock('../src/system-domain-client', (): { requestSystemDomainApi: Mock<RequestSystemDomainApi> } => ({
    requestSystemDomainApi: requestMock,
  }));
}

async function mockPendingAttachFlowRequest(
  _config: SystemDomainClientConfig,
  input: PendingAttachFlowRequest,
): Promise<SystemDomainMutationResponse | SystemDomainStatusResponse> {
  return await Promise.resolve(
    input.method === 'GET' ? buildPendingCustomCertificateStatus(7, 'domop_123') : buildAttachMutationResponse(),
  );
}

async function writeInstallFiles(installPaths: TemporaryInstallPaths): Promise<void> {
  await mkdir(installPaths.configDir, { recursive: true });
  await mkdir(join(installPaths.dataDir, 'self-hosted'), { recursive: true });
  await mkdir(installPaths.customTlsDirectory, { recursive: true });
  await writeFile(
    join(installPaths.configDir, '.env.self-hosted'),
    `COMPARTMENT_CUSTOM_TLS_DIR=${installPaths.customTlsDirectory}
COMPARTMENT_RUNTIME_UID=10001
COMPARTMENT_RUNTIME_GID=10001
COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock
COMPARTMENT_SYSTEM_TOKEN=system-token
`,
    'utf8',
  );
  await writeFile(
    join(installPaths.dataDir, 'self-hosted/install-state.json'),
    `${JSON.stringify({ imageSource: 'registry', installationId: '11111111-1111-4111-8111-111111111111', stateVersion: 1 }, null, 2)}\n`,
    'utf8',
  );
}

function buildPendingCustomCertificateStatus(setupVersion: number, operationId: string): SystemDomainStatusResponse {
  return {
    active: {
      baseDomain: 'localhost',
      caddyMode: 'internal',
      domainKind: 'local',
      publicScheme: 'http',
      tlsMode: 'internal',
    },
    activeDomainHealth: { checkedAt: null, failureCode: null, failureMessage: null, status: 'unknown' },
    pending: {
      certificate: null,
      failureCode: null,
      failureMessage: null,
      hostPlan: {
        baseDomain: 'customer.example.com',
        caddyMode: 'custom-cert',
        domainKind: 'custom',
        publicScheme: 'https',
        tlsMode: 'custom-cert',
      },
      operationId,
      requiredDnsRecords: [],
      status: 'pending_dns',
    },
    setupVersion,
  };
}

function buildAttachMutationResponse(): SystemDomainMutationResponse {
  return {
    operationId: 'domop_123',
    setupVersion: 8,
    status: buildPendingCustomCertificateStatus(8, 'domop_123'),
  };
}
