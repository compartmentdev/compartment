import { isManifestReference } from './registry-manifest-reference';
import type { RegistryCredentialPayload } from './registry-credentials.types';

const immutableIdPattern: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const projectRepositoryPattern: RegExp = /^projects\/(prj_[A-Za-z0-9_-]+)\/services\/(svc_[A-Za-z0-9_-]+)$/u;

export function isRegistryCredentialPayload(
  value: Partial<RegistryCredentialPayload> | null,
  cacheTag: string,
): value is RegistryCredentialPayload {
  if (!hasCredentialBase(value)) {
    return false;
  }
  return value.access === 'pull' ? hasPullCredentialShape(value) : hasWriteCredentialShape(value, cacheTag);
}

function hasCredentialBase(
  value: Partial<RegistryCredentialPayload> | null,
): value is Partial<RegistryCredentialPayload> & Pick<RegistryCredentialPayload, 'access' | 'projectId' | 'version'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.version === 1 &&
    (value.access === 'cleanup' || value.access === 'pull' || value.access === 'push') &&
    typeof value.projectId === 'string' &&
    immutableIdPattern.test(value.projectId)
  );
}

function hasPullCredentialShape(value: Partial<RegistryCredentialPayload>): boolean {
  const projectPull: boolean =
    value.cacheTag === undefined &&
    value.repository === undefined &&
    value.tag === undefined &&
    value.expiresAt === undefined;
  const scopedPull: boolean =
    value.cacheTag === undefined &&
    typeof value.repository === 'string' &&
    isProjectRepositoryForProject(value.repository, value.projectId) &&
    value.tag === undefined &&
    hasSafeExpiry(value);
  return projectPull || scopedPull;
}

function hasWriteCredentialShape(value: Partial<RegistryCredentialPayload>, cacheTag: string): boolean {
  return (
    typeof value.repository === 'string' &&
    isProjectRepositoryForProject(value.repository, value.projectId) &&
    typeof value.tag === 'string' &&
    isManifestReference(value.tag) &&
    (value.access !== 'push' || value.cacheTag === cacheTag) &&
    hasSafeExpiry(value)
  );
}

export function isProjectRepositoryForProject(repository: string, projectId: string | undefined): boolean {
  return projectRepositoryPattern.exec(repository)?.[1] === projectId;
}

function hasSafeExpiry(value: Partial<RegistryCredentialPayload>): boolean {
  return typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt);
}
