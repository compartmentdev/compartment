import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DomainHostPlan, SystemDomainCertificate } from '@compartment/contracts';
import { buildPendingSystemDomainCertificatePaths, type PendingSystemDomainCertificatePaths } from '@compartment/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { type ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import { readPendingSystemDomainCertificate } from '../src/services/system-domain-pending-certificate.service';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const pendingCertificatePem: string = `-----BEGIN CERTIFICATE-----
MIIDZjCCAk6gAwIBAgIUeaX6aBQs5yygbi9OPeTePEuuVlYwDQYJKoZIhvcNAQEL
BQAwITEfMB0GA1UEAwwWKi5jdXN0b21lci5leGFtcGxlLmNvbTAeFw0yMDAxMDEw
MDAwMDBaFw0zNjAxMDEwMDAwMDBaMCExHzAdBgNVBAMMFiouY3VzdG9tZXIuZXhh
bXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCPjBkYO2Ug
ktjaZ8e45CW6dVg3jFv8UMavbDWP/RRIUEqB9jD/G3dTZOwlkopXTFVPn3UUFQ5c
CLTg24iagLWqu1QFiDdlfauTUZPqaISF5UWfUWaraap3cnQPsip+i5TcQx5akni7
ZZLr+5bu1t0G+cwfDy5WkPDXgojxCL/HzUP5lXvr/sm40m4sqdsXvPW/9sltLjEH
Rz16EFgMchTMff8kmrfdoD1PJJcZytk3N43qgGMRUhBt0U16kf/+igdO7tb9vIWf
9ISAx8RQEj+cQfWGiLi0zGZDrp79ApDxvLJlHWvjS4KgyokR35ZVjgWj/DBpjSvV
zlICJvRE0sa9AgMBAAGjgZUwgZIwHQYDVR0OBBYEFFpwzIVWPE0n5Ro3RgQMLSu3
W5hZMB8GA1UdIwQYMBaAFFpwzIVWPE0n5Ro3RgQMLSu3W5hZMA8GA1UdEwEB/wQF
MAMBAf8wPwYDVR0RBDgwNoIWKi5jdXN0b21lci5leGFtcGxlLmNvbYIcY29uc29s
ZS5jdXN0b21lci5leGFtcGxlLmNvbTANBgkqhkiG9w0BAQsFAAOCAQEAAgfK0N8n
aENeDBWAbm774S/X/MvLT6l/a1fhOy45CBe4eKLO2RNRt3L9wG1fZgi2IcQ5Xfif
J6orBT+WdbexVoq1RXEMnCKDk6lIINv/s2px2ArXT6yWl324c8H+Yf0JG9v/qJE1
25KD9la+/B3i6T+gH39HgOOr3ahp6VnbSZ2CNSnjgJQjj6CzO9XPbJdGB3bFFwuN
VDnEuxLSUl/tT9tjQB+fNsoa7aW8fbuRcwOEMCP9DFDD+5iKIc7K9qmgI6f6CAYV
9UPWVqnn1hYIwEG9rYxcCIc/Xs9AfxFcsSY7qsepbx12bSQC9fUP5EL8kg5Leip3
L7RAHor0FFHL5w==
-----END CERTIFICATE-----
`;

const pendingPrivateKeyPem: string = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCPjBkYO2Ugktja
Z8e45CW6dVg3jFv8UMavbDWP/RRIUEqB9jD/G3dTZOwlkopXTFVPn3UUFQ5cCLTg
24iagLWqu1QFiDdlfauTUZPqaISF5UWfUWaraap3cnQPsip+i5TcQx5akni7ZZLr
+5bu1t0G+cwfDy5WkPDXgojxCL/HzUP5lXvr/sm40m4sqdsXvPW/9sltLjEHRz16
EFgMchTMff8kmrfdoD1PJJcZytk3N43qgGMRUhBt0U16kf/+igdO7tb9vIWf9ISA
x8RQEj+cQfWGiLi0zGZDrp79ApDxvLJlHWvjS4KgyokR35ZVjgWj/DBpjSvVzlIC
JvRE0sa9AgMBAAECggEAMsoLBvvc6A2NFJmrnMt8XeCu+dh7o2ahJehPe0a8Kmne
MuV8qIZ7TdJji1eyAvlLJgTxU82vavjZpsWGK8RmgqYNMHflwc8ZKeKvRzz7xrQ8
UgZnITcdzW19iyAq0ONqJBTLZJh2hzeFKGG4IYF8ar9vbX3dk1ttG5NgCIhj8rky
Jwhz0RfNLv1NI488nGaKnjN5nATivhLZJ7c/4RakOXzGvbGsZ3TjbPkkgQ8O+jCZ
Bv+4X+T+HIGykcuDzuCa46AEu6ZvsDl2z1QxjaYX1gZADpqBC87uCZH3kg9lo2KN
5mAOyD5CGoWml5wsa7tYxMBa3XGdorgcy2xosHX4sQKBgQDEPjGCZyET6IuSx9hj
dq0kbY0ypKpxhNWoWhgVTScmp4MSgC52zlF4yQFmtfpY8cquLzGuMG/Ce57AZhBm
BeKMefyqaLt0e2x7pru/fEuCCe8YEshB44tu4kXeyfWtH5BWzcRqw4KNSvMUHipe
+/HR3qbSMHIHQi7cdg/KyWcLLwKBgQC7QhimK6peyTpQXb+UjvcZNRxamQOmvzD7
29NCK17VD0lDWMVY8DRIlppoJAHIualAGE1BlDSvs5RgnaWH1sdBjYGEHMN4USpK
uxnrdWieFWn7eNifupl9AWdTNdgIZklQJK9IIaDVnohw4BHoygB8XrxPoVH04RsS
DuGjT+Sh0wKBgQC6c4jgqBGCc9CgreXHYstQsBGWi2Mxpg7F/IujOYG4NTHQkx8S
XCaGRxxgtQfeGCUE5+wg3v5gXsnPbWmpNXAxHfnVAtsP6fCBb0I0xeiL7dpQGhBQ
odwphyzxZxtX2IRwJOK4uXdBvXNEqwCA7ImuaAhB7it5AAW8CyQn/ME9mwKBgHrp
epZv6OdIfA9OSbbwVD7mfpL1BtGHg1Z9xuAS6a891l/vP7IOELNorzcWE1m2i+J3
URZvelmtrQHx2DoefzGG+XFHFALAe9sLjorfyOiis6sNelr1t1O2/SRAHmn9Abgq
LCdTc2dkJLi6Suca2FDKOh6mi84Jh6RFwlNY2IBjAoGBAJE3GyaAIqS6l8MsxvcO
7BsSD+BswxQqz9ezjMge2fU3ejLDPRGKwMdbt0eHCxNapjfWIISakYa2HZ4+yVuF
1NUVt2+hOccmCYFdgLdUzdn87PcR1ynghOrxAXPrQXwA1I0gl0Gw1ZYm3U7WIOg7
DseN3Yi5o8Sy6/8VkiFu7TYK
-----END PRIVATE KEY-----
`;

const matchingHostPlan: DomainHostPlan = {
  baseDomain: 'customer.example.com',
  caddyMode: 'custom-cert',
  domainKind: 'custom',
  publicScheme: 'https',
  tlsMode: 'custom-cert',
};

const temporaryDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  clearApiRuntime();
  await Promise.all(
    temporaryDirectories.map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  temporaryDirectories.length = 0;
});

describe('system domain pending certificate service', (): void => {
  it('reads a staged certificate for a matching host plan', async (): Promise<void> => {
    const customTlsDirectory: string = await createTemporaryTlsDirectory();
    configurePendingCertificateRuntime(customTlsDirectory);
    await writePendingCertificateFiles(customTlsDirectory, 'domop_123', pendingCertificatePem, pendingPrivateKeyPem);

    const certificate: SystemDomainCertificate = await readPendingSystemDomainCertificate(
      'domop_123',
      matchingHostPlan,
    );

    expect(certificate.certificatePath).toBe(
      buildPendingSystemDomainCertificatePaths(customTlsDirectory, 'domop_123').certificatePath,
    );
    expect(certificate.metadata.dnsNames).toEqual(['*.customer.example.com', 'console.customer.example.com']);
  });

  it('rejects a staged private key that does not match the certificate', async (): Promise<void> => {
    const customTlsDirectory: string = await createTemporaryTlsDirectory();
    configurePendingCertificateRuntime(customTlsDirectory);
    await writePendingCertificateFiles(
      customTlsDirectory,
      'domop_123',
      pendingCertificatePem,
      createMismatchedPrivateKeyPem(),
    );

    await expect(readPendingSystemDomainCertificate('domop_123', matchingHostPlan)).rejects.toThrow(
      'The staged private key does not match the certificate public key.',
    );
  });

  it('rejects a staged certificate that does not cover the pending host plan', async (): Promise<void> => {
    const customTlsDirectory: string = await createTemporaryTlsDirectory();
    configurePendingCertificateRuntime(customTlsDirectory);
    await writePendingCertificateFiles(customTlsDirectory, 'domop_123', pendingCertificatePem, pendingPrivateKeyPem);

    await expect(
      readPendingSystemDomainCertificate('domop_123', {
        ...matchingHostPlan,
        baseDomain: 'other.example.com',
      }),
    ).rejects.toThrow(
      /The staged certificate must cover (console\.other\.example\.com and \*\.other\.example\.com|\*\.other\.example\.com and console\.other\.example\.com)\./u,
    );
  });

  it('rejects pending operation ids that are not safe path segments', async (): Promise<void> => {
    const customTlsDirectory: string = await createTemporaryTlsDirectory();
    configurePendingCertificateRuntime(customTlsDirectory);

    await expect(readPendingSystemDomainCertificate('../escape', matchingHostPlan)).rejects.toThrow(
      'The pending system-domain operation id must be a single safe path segment.',
    );
  });
});

async function createTemporaryTlsDirectory(): Promise<string> {
  const temporaryDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-api-pending-cert-'));
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}

function configurePendingCertificateRuntime(customTlsDirectory: string): void {
  configureApiRuntime({
    config: createApiConfig(customTlsDirectory),
    db: {} as Database,
  });
}

function createApiConfig(customTlsDirectory: string): ApiConfig {
  return {
    baseDomain: 'example.compartment.run',
    bindHost: '127.0.0.1',
    caddyTlsMode: 'managed',
    customTlsDirectory,
    controlPlaneHost: 'console.example.compartment.run',
    databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
    edgeToken: 'edge-token',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    port: 9443,
    publicHttpPort: 80,
    publicHttpsPort: 443,
    publicProtocol: 'https',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
    runtimeControlToken: 'runtime-token',
    sessionSecret: 'test-session-secret',
    sessionTtlMs: 604_800_000,
    sourceArchiveDirectory: '/tmp/source-archives',
    sourceArchiveMaxBytes: 104_857_600,
    throttle: defaultApiAuthThrottleConfig,
    systemApiSocketPath: '/tmp/compartment/system-api.sock',
    systemToken: 'system-token',
    trustedOutboundHosts: [],
    variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  };
}

async function writePendingCertificateFiles(
  customTlsDirectory: string,
  operationId: string,
  certificatePem: string,
  privateKeyPem: string,
): Promise<void> {
  const paths: PendingSystemDomainCertificatePaths = buildPendingSystemDomainCertificatePaths(
    customTlsDirectory,
    operationId,
  );
  await mkdir(join(customTlsDirectory, operationId), { recursive: true });
  await writeFile(paths.certificatePath, certificatePem, 'utf8');
  await writeFile(paths.privateKeyPath, privateKeyPem, 'utf8');
}

function createMismatchedPrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });

  return privateKey;
}
