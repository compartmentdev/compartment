import { isManifestReference } from './registry-manifest-reference';
import type { RegistryCredentialPayload } from './registry-credentials.types';

const immutableIdPattern: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
export const projectRepositoryPattern: RegExp = /^projects\/(prj_[A-Za-z0-9_-]+)\/services\/(svc_[A-Za-z0-9_-]+)$/u;

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
  return (
    value.cacheTag === undefined &&
    value.repository === undefined &&
    value.tag === undefined &&
    value.expiresAt === undefined
  );
}

function hasWriteCredentialShape(value: Partial<RegistryCredentialPayload>, cacheTag: string): boolean {
  return (
    typeof value.repository === 'string' &&
    projectRepositoryPattern.test(value.repository) &&
    value.repository.startsWith(`projects/${value.projectId ?? ''}/`) &&
    typeof value.tag === 'string' &&
    isManifestReference(value.tag) &&
    (value.access !== 'push' || value.cacheTag === cacheTag) &&
    typeof value.expiresAt === 'number' &&
    Number.isSafeInteger(value.expiresAt)
  );
}
