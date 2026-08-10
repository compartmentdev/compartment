import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import {
  compartmentCurrentOrganizationHeaderName,
  compartmentDeploymentsPathname,
  compartmentSourcePackageMetadataArchivePath,
  compartmentSourceUploadsPathname,
  installResponseSchema,
  serializeCompartmentSourcePackageMetadata,
  sourceUploadArchiveMultipartFieldName,
  sourceUploadSummarySchema,
  variableResponseSchema,
  workerClaimDeploymentResponseSchema,
  workerClaimNextDeploymentPathname,
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredDescriptorInput,
  type CompartmentRouteRule,
  type CompartmentRoutesFile,
  type CompartmentSourcePackageMetadata,
  type DeployRequestInput,
  type DeployResponse,
  type DeploymentLogLine,
  type DeploymentSummary,
  type InstallResponse,
  type SetVariableRequest,
  type SourceUploadSummary,
  type TenantSecretEnvelope,
  type TenantSecretEnvironment,
  type VariableResponse,
  type WorkerClaimDeploymentResponse,
  type WorkerClaimedDeployment,
} from '@compartment/contracts';
import { issueBuildSourceArchiveCredential } from '@compartment/utils';
import type { LightMyRequestResponse } from 'fastify';
import type { PoolClient } from 'pg';
import { expect } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { readApiInstallToken } from '../src/config';
import {
  findNextDeploymentReconcilePair,
  persistDeploymentReconcileObservation,
} from '../src/queries/deployment-reconcile.query';
import { testRuntimeControlToken } from './api-app-test.harness';
import type { DeploymentReconcilePair } from '../src/queries/deployment-reconcile.query.types';
import { prepareDeploymentReconcile } from '../src/services/deployment-reconcile.service';
import type { SourceArchiveTarEntryKind } from '../src/services/deployment-source-build-validation-archive.types';
import type { StoredDeploymentRow } from './api.integration.types';

const executeFileAsync: (file: string, args: readonly string[]) => Promise<{ stderr: string; stdout: string }> =
  promisify(execFile);
const multipartLineBreak: string = '\r\n';
const tarBlockByteLength: number = 512;
const concurrentDatabaseWorkWaitMs: number = 200;
const testMaximumConcurrentBuilds: number = 100;
const testMaximumConcurrentBuildsPerOrganization: number = 100;
const defaultRootSourcePackageMetadata: CompartmentSourcePackageMetadata = {
  descriptorDirectoryRelativePath: '.',
  version: 1,
};

export type RawSourceArchiveEntryType = SourceArchiveTarEntryKind;

export interface RawSourceArchiveEntry {
  contents?: string;
  path: string;
  type: RawSourceArchiveEntryType;
}

interface InjectDeployRequestOptions {
  descriptor?: CompartmentAuthoredDescriptorInput | undefined;
  environmentName?: string | undefined;
  label?: string | undefined;
  onboardingSessionId?: string | undefined;
  routes?: CompartmentRoutesFile | undefined;
  serviceName?: string | undefined;
  sourceArchive?: Buffer | undefined;
}

interface InjectSourceUploadRequestOptions {
  environmentName?: string | undefined;
  projectName?: string | undefined;
  serviceName?: string | undefined;
  sourceArchive?: Buffer | undefined;
}

export interface ExpectedRunConfig {
  command?: string | undefined;
}

interface InjectJsonDeployRequestOptions {
  descriptor?: CompartmentAuthoredDescriptorInput | undefined;
  environmentName?: string | undefined;
  label?: string | undefined;
  onboardingSessionId?: string | undefined;
  projectName?: string | undefined;
  routes?: CompartmentRoutesFile | undefined;
  serviceName?: string | undefined;
  sourceUploadId: string;
}

export interface MultipartRequest {
  contentType: string;
  payload: Buffer;
}

interface MultipartRequestFieldPart {
  fieldName: string;
  kind: 'field';
  value: string;
}

interface MultipartRequestFilePart {
  contentType: string;
  fieldName: string;
  fileContents: Buffer;
  fileName: string;
  kind: 'file';
}

export async function installCompartment(apiApp: ApiApp): Promise<InstallResponse> {
  const installAdminCredential: string = 'supersecretpassword';
  const installResponse: LightMyRequestResponse = await apiApp.inject({
    headers: buildInstallAuthorizationHeaders(),
    method: 'POST',
    payload: {
      adminEmail: 'admin@example.com',
      adminPassword: installAdminCredential,
      baseDomain: 'localhost',
      organizationName: 'Acme Dev',
      organizationSlug: 'acme-dev',
    },
    url: '/v1/install',
  });
  expect(installResponse.statusCode, `Install setup failed: ${installResponse.body}`).toBe(200);

  return installResponseSchema.parse(installResponse.json());
}

export function buildInstallAuthorizationHeaders(token: string = readApiInstallToken()): Record<string, string> {
  return buildSystemAuthorizationHeaders(token);
}

export function createExpectedRunConfig(command?: string): ExpectedRunConfig {
  return {
    ...(command !== undefined ? { command } : {}),
  };
}

export function buildOrganizationAuthorizationHeaders(
  token: string,
  organizationSlug: string = 'acme-dev',
): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    [compartmentCurrentOrganizationHeaderName]: organizationSlug,
  };
}

export function buildSystemAuthorizationHeaders(token: string = 'test-system-token'): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

export async function injectDeployRequest(
  apiApp: ApiApp,
  sessionToken: string,
  organizationSlug: string,
  projectNameOrOptions: string | InjectDeployRequestOptions = 'smoke-web',
): Promise<LightMyRequestResponse> {
  const options: InjectDeployRequestOptions = typeof projectNameOrOptions === 'string' ? {} : projectNameOrOptions;
  const projectName: string =
    typeof projectNameOrOptions === 'string' ? projectNameOrOptions : (options.descriptor?.name ?? 'smoke-web');
  const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
    apiApp,
    sessionToken,
    organizationSlug,
    {
      ...(options.environmentName !== undefined ? { environmentName: options.environmentName } : {}),
      projectName,
      sourceArchive: options.sourceArchive ?? (await createDefaultDeploySourceArchive(options.routes)),
    },
  );
  if (sourceUploadResponse.statusCode !== 200) {
    return sourceUploadResponse;
  }
  const sourceUpload: SourceUploadSummary = sourceUploadSummarySchema.parse(sourceUploadResponse.json());

  return await injectJsonDeployRequest(apiApp, sessionToken, organizationSlug, {
    descriptor: options.descriptor ?? createDeployDescriptor(projectName),
    ...(options.environmentName !== undefined ? { environmentName: options.environmentName } : {}),
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(options.onboardingSessionId !== undefined ? { onboardingSessionId: options.onboardingSessionId } : {}),
    ...(options.routes !== undefined ? { routes: options.routes } : {}),
    ...(options.serviceName !== undefined ? { serviceName: options.serviceName } : {}),
    sourceUploadId: sourceUpload.id,
  });
}

export async function injectSourceUploadRequest(
  apiApp: ApiApp,
  sessionToken: string,
  organizationSlug: string,
  sourceArchiveOrOptions?: Buffer | InjectSourceUploadRequestOptions,
): Promise<LightMyRequestResponse> {
  const options: InjectSourceUploadRequestOptions = Buffer.isBuffer(sourceArchiveOrOptions)
    ? { sourceArchive: sourceArchiveOrOptions }
    : (sourceArchiveOrOptions ?? {});
  const multipartRequest: MultipartRequest = buildMultipartRequest([
    createSourceArchiveMultipartPart(options.sourceArchive ?? (await createDefaultDeploySourceArchive())),
  ]);

  return await apiApp.inject({
    headers: {
      authorization: `Bearer ${sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: organizationSlug,
      'content-type': multipartRequest.contentType,
    },
    method: 'POST',
    payload: multipartRequest.payload,
    url: buildSourceUploadUrl(options),
  });
}

export async function createUploadedSourceArchive(
  apiApp: ApiApp,
  sessionToken: string,
  organizationSlug: string,
  sourceArchive?: Buffer,
): Promise<SourceUploadSummary> {
  const response: LightMyRequestResponse = await injectSourceUploadRequest(
    apiApp,
    sessionToken,
    organizationSlug,
    sourceArchive,
  );
  expect(response.statusCode).toBe(200);

  return sourceUploadSummarySchema.parse(response.json());
}

function buildSourceUploadUrl(options: InjectSourceUploadRequestOptions): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  appendOptionalSearchParam(searchParams, 'projectName', options.projectName);
  appendOptionalSearchParam(searchParams, 'environmentName', options.environmentName);
  appendOptionalSearchParam(searchParams, 'serviceName', options.serviceName);
  const search: string = searchParams.toString();

  return search === '' ? compartmentSourceUploadsPathname : `${compartmentSourceUploadsPathname}?${search}`;
}

function appendOptionalSearchParam(searchParams: URLSearchParams, name: string, value: string | undefined): void {
  if (value !== undefined) {
    searchParams.set(name, value);
  }
}

export async function injectJsonDeployRequest(
  apiApp: ApiApp,
  sessionToken: string,
  organizationSlug: string,
  options: InjectJsonDeployRequestOptions,
): Promise<LightMyRequestResponse> {
  const payload: DeployRequestInput = {
    descriptor: options.descriptor ?? createDeployDescriptor(options.projectName ?? 'smoke-web'),
    ...(options.environmentName !== undefined ? { environmentName: options.environmentName } : {}),
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(options.onboardingSessionId !== undefined ? { onboardingSessionId: options.onboardingSessionId } : {}),
    ...(options.routes !== undefined ? { routes: options.routes } : {}),
    ...(options.serviceName !== undefined ? { serviceName: options.serviceName } : {}),
    sourceUploadId: options.sourceUploadId,
  };

  return await apiApp.inject({
    headers: {
      authorization: `Bearer ${sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: organizationSlug,
    },
    method: 'POST',
    payload,
    url: compartmentDeploymentsPathname,
  });
}

export async function setVariable(
  apiApp: ApiApp,
  sessionToken: string,
  organizationSlug: string,
  payload: SetVariableRequest,
): Promise<VariableResponse> {
  const response: LightMyRequestResponse = await apiApp.inject({
    method: 'POST',
    payload,
    url: '/v1/variables',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: organizationSlug,
    },
  });

  expect(response.statusCode).toBe(200);

  return variableResponseSchema.parse(response.json());
}

export async function createSourceArchive(
  files: Record<string, string>,
  sourcePackageMetadata: CompartmentSourcePackageMetadata | null = defaultRootSourcePackageMetadata,
  symlinks: Record<string, string> = {},
): Promise<Buffer> {
  const sourceDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-api-integration-source-'));
  const archiveDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-api-integration-archive-'));
  const archivePath: string = join(archiveDirectory, 'source.tgz');

  try {
    await writeArchiveFiles(sourceDirectory, files);
    await writeArchiveSymlinks(sourceDirectory, symlinks);
    if (sourcePackageMetadata !== null) {
      await writeArchiveFiles(sourceDirectory, {
        [compartmentSourcePackageMetadataArchivePath]: serializeCompartmentSourcePackageMetadata(sourcePackageMetadata),
      });
    }
    await executeFileAsync('tar', ['-czf', archivePath, '-C', sourceDirectory, '.']);

    return await readFile(archivePath);
  } finally {
    await Promise.all([
      rm(sourceDirectory, { force: true, recursive: true }),
      rm(archiveDirectory, { force: true, recursive: true }),
    ]);
  }
}

export function createRawSourceArchive(
  entries: readonly RawSourceArchiveEntry[],
  sourcePackageMetadata: CompartmentSourcePackageMetadata | null = defaultRootSourcePackageMetadata,
): Buffer {
  const archiveEntries: RawSourceArchiveEntry[] = [
    ...entries,
    ...(sourcePackageMetadata === null
      ? []
      : [
          {
            contents: serializeCompartmentSourcePackageMetadata(sourcePackageMetadata),
            path: compartmentSourcePackageMetadataArchivePath,
            type: 'file',
          } satisfies RawSourceArchiveEntry,
        ]),
  ];

  return gzipSync(Buffer.concat([...archiveEntries.flatMap(createRawTarEntryBuffers), Buffer.alloc(1024)]));
}

async function writeArchiveFiles(rootDirectory: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]: [string, string]): Promise<void> => {
      const filePath: string = join(rootDirectory, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, contents);
    }),
  );
}

async function writeArchiveSymlinks(rootDirectory: string, symlinks: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(symlinks).map(async ([relativePath, targetPath]: [string, string]): Promise<void> => {
      const filePath: string = join(rootDirectory, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await symlink(targetPath, filePath);
    }),
  );
}

function createRawTarEntryBuffers(entry: RawSourceArchiveEntry): Buffer[] {
  const contentsBuffer: Buffer = Buffer.from(entry.contents ?? '', 'utf8');
  const headerBuffer: Buffer = createTarHeaderBuffer(entry, contentsBuffer.length);

  if (entry.type === 'directory') {
    return [headerBuffer];
  }

  return [headerBuffer, contentsBuffer, Buffer.alloc(readTarPaddingByteLength(contentsBuffer.length))];
}

function createTarHeaderBuffer(entry: RawSourceArchiveEntry, size: number): Buffer {
  const headerBuffer: Buffer = Buffer.alloc(tarBlockByteLength);
  const headerPath: string = entry.type === 'directory' && !entry.path.endsWith('/') ? `${entry.path}/` : entry.path;

  writeTarStringField(headerBuffer, 0, 100, headerPath);
  writeTarOctalField(headerBuffer, 100, 8, entry.type === 'directory' ? 0o755 : 0o644);
  writeTarOctalField(headerBuffer, 108, 8, 0);
  writeTarOctalField(headerBuffer, 116, 8, 0);
  writeTarOctalField(headerBuffer, 124, 12, entry.type === 'directory' ? 0 : size);
  writeTarOctalField(headerBuffer, 136, 12, 0);
  headerBuffer[156] = readRawTarEntryTypeByte(entry.type);
  writeTarStringField(headerBuffer, 257, 6, 'ustar');
  writeTarStringField(headerBuffer, 263, 2, '00');
  writeTarChecksumField(headerBuffer);

  return headerBuffer;
}

function readRawTarEntryTypeByte(entryType: RawSourceArchiveEntryType): number {
  switch (entryType) {
    case 'directory':
      return '5'.charCodeAt(0);
    case 'extended-header':
      return 'x'.charCodeAt(0);
    case 'file':
      return '0'.charCodeAt(0);
    case 'global-extended-header':
      return 'g'.charCodeAt(0);
    case 'long-link':
      return 'K'.charCodeAt(0);
    case 'long-path':
      return 'L'.charCodeAt(0);
  }
}

function writeTarChecksumField(headerBuffer: Buffer): void {
  headerBuffer.fill(' '.charCodeAt(0), 148, 156);
  const checksum: number = headerBuffer.reduce((sum: number, byteValue: number): number => sum + byteValue, 0);

  const checksumText: string = checksum.toString(8).padStart(6, '0');
  headerBuffer.write(checksumText, 148, 6, 'ascii');
  headerBuffer[154] = 0;
  headerBuffer[155] = ' '.charCodeAt(0);
}

function writeTarOctalField(headerBuffer: Buffer, offset: number, length: number, value: number): void {
  const octalValue: string = value.toString(8).padStart(length - 1, '0');
  headerBuffer.write(octalValue, offset, length - 1, 'ascii');
}

function writeTarStringField(headerBuffer: Buffer, offset: number, length: number, value: string): void {
  headerBuffer.write(value, offset, Math.min(Buffer.byteLength(value, 'utf8'), length), 'utf8');
}

function readTarPaddingByteLength(size: number): number {
  const remainder: number = size % tarBlockByteLength;
  return remainder === 0 ? 0 : tarBlockByteLength - remainder;
}

async function createDefaultDeploySourceArchive(routes?: CompartmentRoutesFile): Promise<Buffer> {
  const files: Record<string, string> = {
    'compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
    'services/backoffice/package.json': '{"name":"backoffice"}\n',
    'services/web/package.json': '{"name":"web"}\n',
    'package.json': '{"name":"root"}\n',
  };
  if (routes !== undefined) {
    files['compartment.routes.yml'] = serializeRoutesFile(routes);
  }

  return await createSourceArchive(files);
}

function serializeRoutesFile(routes: CompartmentRoutesFile): string {
  if (routes.routes.length === 0) {
    return 'version: 1\n\nroutes: []\n';
  }

  const serializedRoutes: string = routes.routes.map(renderRoutesFileEntry).join('\n');

  return `version: 1\n\nroutes:\n${serializedRoutes}\n`;
}

function renderRoutesFileEntry(route: CompartmentRouteRule): string {
  const stripPrefixLine: string = route.stripPrefix === undefined ? '' : `\n    stripPrefix: ${route.stripPrefix}`;

  return `  - on: ${route.on}\n    path: ${route.path}\n    to: ${route.to}${stripPrefixLine}`;
}

export function buildMultipartRequest(parts: readonly MultipartRequestPart[]): MultipartRequest {
  const boundary: string = `----compartment-test-${randomBytes(12).toString('hex')}`;
  const chunks: Buffer[] = [];

  for (const part of parts) {
    if (part.kind === 'field') {
      appendMultipartField(chunks, boundary, part.fieldName, part.value);
      continue;
    }

    appendMultipartFile(chunks, boundary, part.fieldName, part.fileName, part.contentType, part.fileContents);
  }
  chunks.push(Buffer.from(`--${boundary}--${multipartLineBreak}`, 'utf8'));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat(chunks),
  };
}

export function createMultipartFieldPart(fieldName: string, value: string): MultipartRequestFieldPart {
  return {
    fieldName,
    kind: 'field',
    value,
  };
}

export function createMultipartFilePart(
  fieldName: string,
  fileContents: Buffer,
  fileName: string,
  contentType: string,
): MultipartRequestFilePart {
  return {
    contentType,
    fieldName,
    fileContents,
    fileName,
    kind: 'file',
  };
}

function createSourceArchiveMultipartPart(sourceArchive: Buffer): MultipartRequestFilePart {
  return createMultipartFilePart(
    sourceUploadArchiveMultipartFieldName,
    sourceArchive,
    'source.tgz',
    'application/gzip',
  );
}

function appendMultipartField(chunks: Buffer[], boundary: string, fieldName: string, value: string): void {
  chunks.push(
    Buffer.from(
      `--${boundary}${multipartLineBreak}` +
        `Content-Disposition: form-data; name="${fieldName}"${multipartLineBreak}${multipartLineBreak}` +
        `${value}${multipartLineBreak}`,
      'utf8',
    ),
  );
}

function appendMultipartFile(
  chunks: Buffer[],
  boundary: string,
  fieldName: string,
  fileName: string,
  contentType: string,
  fileContents: Buffer,
): void {
  chunks.push(
    Buffer.from(
      `--${boundary}${multipartLineBreak}` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"${multipartLineBreak}` +
        `Content-Type: ${contentType}${multipartLineBreak}${multipartLineBreak}`,
      'utf8',
    ),
    fileContents,
    Buffer.from(multipartLineBreak, 'utf8'),
  );
}

export function createDeployDescriptor(projectName: string): CompartmentAuthoredDescriptor {
  return {
    name: projectName,
    services: {
      web: '.',
    },
  };
}

export function createMultiServiceDescriptor(): CompartmentAuthoredDescriptor {
  return {
    name: 'smoke-multi-service',
    services: {
      backoffice: {
        kind: 'api',
        path: './services/backoffice',
        readiness: {
          path: '/ready',
          timeoutMs: 30000,
          type: 'http',
        },
      },
      web: {
        path: './services/web',
        readiness: {
          path: '/healthz',
          timeoutMs: 30000,
          type: 'http',
        },
      },
    },
  };
}

export function createUnsupportedKindDescriptor(): CompartmentAuthoredDescriptor {
  return {
    name: 'smoke-worker',
    services: {
      worker: {
        kind: 'worker',
        path: './services/worker',
      },
    },
  };
}

export function createMultiServiceRoutes(): CompartmentRoutesFile {
  return {
    routes: [
      {
        on: 'web',
        path: '/api/*',
        stripPrefix: '/api',
        to: 'backoffice',
      },
    ],
    version: 1,
  };
}

export async function completeQueuedDeployment(
  apiApp: ApiApp,
  deploymentId: string,
  routeHost: string = 'smoke-web.localhost',
): Promise<void> {
  await claimNextQueuedDeployment(apiApp);
  await completeClaimedDeployment(apiApp, deploymentId, routeHost);
}

export async function completeClaimedDeployment(
  _apiApp: ApiApp,
  deploymentId: string,
  routeHost: string = 'smoke-web.localhost',
  observedAt: Date = new Date(),
): Promise<void> {
  await prepareDeploymentReconcile({
    deploymentId,
    deploymentName: `app-${deploymentId}`,
    imageRef: 'registry.example/app@sha256:image',
    namespace: `cpt-${deploymentId}`,
    networkPolicyNames: [],
    routeHost,
    serviceName: 'app',
  });
  expect(
    await persistDeploymentReconcileObservation({
      deploymentId,
      failureMessage: null,
      observation: 'pending',
      observedAt,
      revision: 0,
    }),
  ).toBe(true);
  expect(
    await persistDeploymentReconcileObservation({
      deploymentId,
      failureMessage: null,
      observation: 'ready',
      observedAt,
      revision: 1,
    }),
  ).toBe(true);
}

export async function acknowledgeKubeDeploymentStopped(deploymentId: string): Promise<void> {
  const deadline: number = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const claimed: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();
    if (claimed?.candidate.deploymentId === deploymentId && claimed.candidate.state === 'stopping') {
      expect(
        await persistDeploymentReconcileObservation({
          deploymentId,
          failureMessage: null,
          observation: 'stopped',
          observedAt: new Date(),
          revision: claimed.candidate.revision,
        }),
      ).toBe(true);
      return;
    }
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error(`Deployment ${deploymentId} did not become claimable for Kubernetes stop.`);
}

export function requireClaimedDeployment(response: WorkerClaimDeploymentResponse): WorkerClaimedDeployment {
  if (response.deployment === null) {
    throw new Error('Expected a claimed deployment.');
  }

  return response.deployment;
}

export function requireTenantSecretEnvelope(
  environment: TenantSecretEnvironment,
  keyName: string,
): TenantSecretEnvelope {
  const envelope: TenantSecretEnvelope | undefined = environment[keyName];
  if (envelope === undefined) {
    throw new Error(`Expected tenant secret envelope "${keyName}".`);
  }
  return envelope;
}

export function requireClaimedDeploymentByServiceName(
  claimedDeployments: WorkerClaimedDeployment[],
  serviceName: string,
): WorkerClaimedDeployment {
  const deployment: WorkerClaimedDeployment | undefined = claimedDeployments.find(
    (candidate: WorkerClaimedDeployment): boolean => candidate.service.name === serviceName,
  );
  if (deployment === undefined) {
    throw new Error(`Expected claimed deployment for service "${serviceName}".`);
  }

  return deployment;
}

export function requireDeployResponseDeployment(response: DeployResponse): DeploymentSummary {
  const deployment: DeploymentSummary | undefined = response.deployments[0];
  if (deployment === undefined) {
    throw new Error('Expected a deployment in the deploy response.');
  }

  return deployment;
}

export function requireDeploymentByServiceName<TDeployment extends { serviceName: string }>(
  deploymentTargets: TDeployment[],
  serviceName: string,
): TDeployment {
  const deployment: TDeployment | undefined = deploymentTargets.find(
    (candidate: TDeployment): boolean => candidate.serviceName === serviceName,
  );
  if (deployment === undefined) {
    throw new Error(`Expected deployment for service "${serviceName}".`);
  }

  return deployment;
}

export function requireServiceId<TService extends { id: string; name: string }>(
  services: TService[],
  serviceName: string,
): string {
  const service: TService | undefined = services.find((candidate: TService): boolean => candidate.name === serviceName);
  if (service === undefined) {
    throw new Error(`Expected project service "${serviceName}".`);
  }

  return service.id;
}

export function readStoredRoutesByService(
  storedDeployments: StoredDeploymentRow[],
  projectServiceId: string,
): CompartmentRouteRule[] {
  const deployment: StoredDeploymentRow | undefined = storedDeployments.find(
    (candidate: StoredDeploymentRow): boolean => candidate.projectServiceId === projectServiceId,
  );
  if (deployment === undefined) {
    throw new Error(`Expected stored deployment for project service "${projectServiceId}".`);
  }

  return JSON.parse(deployment.resolvedRoutesJson) as CompartmentRouteRule[];
}

export function requireSingleDeployment<TDeployment>(deploymentTargets: TDeployment[]): TDeployment {
  const deployment: TDeployment | undefined = deploymentTargets[0];
  if (deployment === undefined) {
    throw new Error('Expected a single deployment.');
  }

  return deployment;
}

export function hasLogLineForService(lines: DeploymentLogLine[], serviceName: string): boolean {
  return lines.some((line: DeploymentLogLine): boolean => line.serviceName === serviceName);
}

export function allLogLinesMatchService(lines: DeploymentLogLine[], serviceName: string): boolean {
  return lines.every((line: DeploymentLogLine): boolean => line.serviceName === serviceName);
}

export function requireQueryParam(url: URL, name: string): string {
  const value: string | null = url.searchParams.get(name);
  if (value === null) {
    throw new Error(`Expected query param "${name}".`);
  }

  return value;
}

export function requireSetCookieValue(header: string | string[] | undefined, cookieName: string): string {
  let values: string[] = [];
  if (Array.isArray(header)) {
    values = header;
  } else if (header !== undefined) {
    values = [header];
  }
  const cookiePrefix: string = `${cookieName}=`;
  const cookieHeader: string | undefined = values.find((value: string): boolean => value.startsWith(cookiePrefix));
  if (cookieHeader === undefined) {
    throw new Error(`Expected Set-Cookie for "${cookieName}".`);
  }

  const cookieValue: string | undefined = cookieHeader.slice(cookiePrefix.length).split(';')[0];
  if (cookieValue === undefined || cookieValue === '') {
    throw new Error(`Expected cookie value for "${cookieName}".`);
  }

  return cookieValue;
}

export async function claimNextQueuedDeployment(
  apiApp: ApiApp,
  maximumConcurrentBuilds: number = testMaximumConcurrentBuilds,
  maximumConcurrentBuildsPerOrganization: number = testMaximumConcurrentBuildsPerOrganization,
): Promise<WorkerClaimDeploymentResponse> {
  const claimedResponse: LightMyRequestResponse = await apiApp.inject({
    headers: {
      authorization: 'Bearer test-runtime-control-token',
    },
    method: 'POST',
    payload: {
      maximumConcurrentBuilds,
      maximumConcurrentBuildsPerOrganization,
    },
    url: workerClaimNextDeploymentPathname,
  });
  expect(claimedResponse.statusCode, claimedResponse.body).toBe(200);

  return workerClaimDeploymentResponseSchema.parse(claimedResponse.json());
}

function issueTestBuildSourceArchiveCredential(artifactId: string): string {
  return issueBuildSourceArchiveCredential(testRuntimeControlToken, artifactId, Math.floor(Date.now() / 1_000) + 600);
}

/**
 * The source archive route accepts only a build credential pinned to the artifact being fetched, never the
 * installation runtime control token every other internal worker route takes.
 */
export async function fetchArtifactSourceArchive(
  apiApp: ApiApp,
  artifactId: string,
  credential: string = issueTestBuildSourceArchiveCredential(artifactId),
): Promise<LightMyRequestResponse> {
  return await apiApp.inject({
    headers: { authorization: `Bearer ${credential}` },
    method: 'GET',
    url: `/internal/artifacts/${encodeURIComponent(artifactId)}/source-archive`,
  });
}

export async function rollbackOpenTransaction(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    return;
  }
}

export async function waitForConcurrentDatabaseWork(): Promise<void> {
  await new Promise((resolve: (value: void | PromiseLike<void>) => void): void => {
    setTimeout(resolve, concurrentDatabaseWorkWaitMs);
  });
}

type MultipartRequestPart = MultipartRequestFieldPart | MultipartRequestFilePart;
