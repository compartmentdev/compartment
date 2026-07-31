import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  RegistryCredential,
  RegistryCredentialPayload,
  RegistryRequestAuthorization,
} from './registry-credentials.types';
import { isManifestDigest, isManifestReference } from './registry-manifest-reference';
import { isRegistryCredentialPayload, projectRepositoryPattern } from './registry-credential-payload';

const credentialUsernamePrefix: string = 'compartment-v1-';
const projectIdPattern: RegExp = /^prj_[A-Za-z0-9_-]+$/u;
const registryRequestPattern: RegExp =
  /^\/v2\/(projects\/prj_[A-Za-z0-9_-]+\/services\/svc_[A-Za-z0-9_-]+)\/(?:blobs|manifests|tags)\//u;
const pushCredentialLifetimeSeconds: number = 60 * 60;
const cleanupCredentialLifetimeSeconds: number = 10 * 60;
export const buildCacheTag: string = 'build-cache';

export function issueProjectPullCredential(signingKey: string, projectId: string): RegistryCredential {
  assertProjectId(projectId);
  return signCredential(signingKey, { access: 'pull', projectId, version: 1 });
}

export function issueBuildPushCredential(
  signingKey: string,
  projectId: string,
  repository: string,
  tag: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RegistryCredential {
  assertProjectId(projectId);
  if (!isManifestReference(tag)) {
    throw new Error('tag must be an immutable build reference.');
  }
  assertProjectRepository(repository, projectId);
  return signCredential(signingKey, {
    access: 'push',
    cacheTag: buildCacheTag,
    expiresAt: nowSeconds + pushCredentialLifetimeSeconds,
    projectId,
    repository,
    tag,
    version: 1,
  });
}

export function issueCleanupCredential(
  signingKey: string,
  projectId: string,
  repository: string,
  digest: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RegistryCredential {
  assertProjectId(projectId);
  if (!isManifestDigest(digest)) {
    throw new Error('Cleanup credentials require an immutable manifest digest.');
  }
  assertProjectRepository(repository, projectId);
  return signCredential(signingKey, {
    access: 'cleanup',
    expiresAt: nowSeconds + cleanupCredentialLifetimeSeconds,
    projectId,
    repository,
    tag: digest,
    version: 1,
  });
}

export function authorizeRegistryRequest(
  credential: RegistryCredentialPayload,
  method: string | undefined,
  requestTarget: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RegistryRequestAuthorization | null {
  if (credential.access !== 'pull' && isCredentialExpired(credential, nowSeconds)) {
    return null;
  }
  const repository: string | null = readRequestRepository(requestTarget);
  if (repository === null) {
    return requestTarget === '/v2/' && !isWriteMethod(method) ? { credential, repository } : null;
  }
  if (!repository.startsWith(`projects/${credential.projectId}/`)) {
    return null;
  }
  return authorizeRepositoryRequest(credential, method, requestTarget, repository, nowSeconds);
}

function authorizeRepositoryRequest(
  credential: RegistryCredentialPayload,
  method: string | undefined,
  requestTarget: string | undefined,
  repository: string,
  nowSeconds: number,
): RegistryRequestAuthorization | null {
  if (credential.access === 'push' && credential.repository !== repository) {
    return null;
  }
  if (!isWriteMethod(method)) {
    return credential.access === 'cleanup' ? null : { credential, repository };
  }
  if (credential.access === 'cleanup') {
    return isExactCleanupRequest(credential, method, requestTarget) ? { credential, repository } : null;
  }
  if (!isActivePushCredential(credential, method, repository, requestTarget, nowSeconds)) {
    return null;
  }
  return { credential, repository };
}

export function verifyRegistryCredential(
  signingKey: string,
  authorizationHeader: string | undefined,
): RegistryCredentialPayload | null {
  const parsed: RegistryCredential | null = parseBasicAuthorization(authorizationHeader);
  if (parsed?.username.startsWith(credentialUsernamePrefix) !== true) {
    return null;
  }
  const encodedPayload: string = parsed.username.slice(credentialUsernamePrefix.length);
  const expectedPassword: string = createHmac('sha256', signingKey).update(encodedPayload).digest('base64url');
  if (!timingSafeEquals(parsed.password, expectedPassword)) {
    return null;
  }
  return decodeCredentialPayload(encodedPayload);
}

function signCredential(signingKey: string, payload: RegistryCredentialPayload): RegistryCredential {
  if (signingKey.length < 32) {
    throw new Error('Registry credential signing key must contain at least 32 characters.');
  }
  const encodedPayload: string = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return {
    password: createHmac('sha256', signingKey).update(encodedPayload).digest('base64url'),
    username: `${credentialUsernamePrefix}${encodedPayload}`,
  };
}

function decodeCredentialPayload(encodedPayload: string): RegistryCredentialPayload | null {
  try {
    const payload: Partial<RegistryCredentialPayload> | null = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as Partial<RegistryCredentialPayload> | null;
    return isRegistryCredentialPayload(payload, buildCacheTag) ? payload : null;
  } catch {
    return null;
  }
}

function parseBasicAuthorization(header: string | undefined): RegistryCredential | null {
  if (header?.startsWith('Basic ') !== true) {
    return null;
  }
  const decoded: string = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separatorIndex: number = decoded.indexOf(':');
  return separatorIndex <= 0
    ? null
    : { password: decoded.slice(separatorIndex + 1), username: decoded.slice(0, separatorIndex) };
}

function readRequestRepository(requestTarget: string | undefined): string | null {
  if (requestTarget === undefined || requestTarget.includes('\\') || requestTarget.startsWith('//')) {
    return null;
  }
  const pathname: string = requestTarget.split('?', 1)[0] ?? '';
  if (pathname.includes('%')) {
    return null;
  }
  return registryRequestPattern.exec(pathname)?.[1] ?? null;
}

function assertProjectRepository(repository: string, projectId: string): void {
  const match: RegExpExecArray | null = projectRepositoryPattern.exec(repository);
  if (match?.[1] !== projectId) {
    throw new Error('Registry repository must use the immutable project ID prefix.');
  }
}

function isWriteMethod(method: string | undefined): boolean {
  const normalizedMethod: string | undefined = method?.toUpperCase();
  return normalizedMethod !== undefined && ['DELETE', 'PATCH', 'POST', 'PUT'].includes(normalizedMethod);
}

function isActivePushCredential(
  credential: RegistryCredentialPayload,
  method: string | undefined,
  repository: string,
  requestTarget: string | undefined,
  nowSeconds: number,
): boolean {
  return (
    credential.access === 'push' &&
    credential.expiresAt !== undefined &&
    credential.expiresAt >= nowSeconds &&
    credential.repository === repository &&
    writeMatchesBuildIntent(method, requestTarget, credential)
  );
}

function isExactCleanupRequest(
  credential: RegistryCredentialPayload,
  method: string | undefined,
  requestTarget: string | undefined,
): boolean {
  return (
    method?.toUpperCase() === 'DELETE' &&
    credential.repository !== undefined &&
    credential.tag !== undefined &&
    requestTarget === `/v2/${credential.repository}/manifests/${credential.tag}`
  );
}

function writeMatchesBuildIntent(
  method: string | undefined,
  requestTarget: string | undefined,
  credential: RegistryCredentialPayload,
): boolean {
  if (requestTarget === undefined || credential.tag === undefined || credential.repository === undefined) {
    return false;
  }
  const requestUrl: URL = new URL(requestTarget, 'https://registry.invalid');
  const manifestPrefix: string = `/v2/${credential.repository}/manifests/`;
  if (method?.toUpperCase() === 'DELETE') {
    return false;
  }
  if (requestUrl.pathname.startsWith(manifestPrefix)) {
    const reference: string = requestUrl.pathname.slice(manifestPrefix.length);
    return (
      method?.toUpperCase() === 'PUT' &&
      (reference === credential.tag || reference === credential.cacheTag || isManifestDigest(reference))
    );
  }
  const mountedFrom: string | null = requestUrl.searchParams.get('from');
  return mountedFrom === null || mountedFrom === credential.repository;
}

function isCredentialExpired(credential: RegistryCredentialPayload, nowSeconds: number): boolean {
  return credential.expiresAt === undefined || credential.expiresAt < nowSeconds;
}

function assertProjectId(projectId: string): void {
  if (!projectIdPattern.test(projectId)) {
    throw new Error('projectId must be an immutable project identifier.');
  }
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer: Buffer = Buffer.from(left);
  const rightBuffer: Buffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
