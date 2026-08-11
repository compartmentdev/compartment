import type { SourceUploadCreateQuery } from '@compartment/contracts';
import type { SourceUploadRow } from '../queries/source-uploads.query.types';
import type { AuthSessionOrganizationPolicySession } from './organization-auth-settings.service.types';
import type { StoredSourceUploadArchive } from './source-upload-storage.service.types';

export interface SourceUploadScope {
  environmentId: string | null;
  projectId: string | null;
  projectServiceId: string | null;
}

export interface CreateSourceUploadStreamInput {
  actorPrincipalId: string;
  authSession: AuthSessionOrganizationPolicySession;
  isTruncated?: (() => boolean) | undefined;
  organizationId: string;
  scope: SourceUploadScope;
  sourceArchiveStream: NodeJS.ReadableStream;
}

export interface CreateSourceUploadArchivePathInput {
  actorPrincipalId: string;
  archivePath: string;
  organizationId: string;
  sourceId: string;
}

export interface ResolveSourceUploadScopeInput {
  actorPrincipalId: string;
  organizationId: string;
  organizationSlug: string;
  query: SourceUploadCreateQuery;
}

export interface PreparedSourceUploadArchive {
  sourceUploadId: string;
  storedArchive: StoredSourceUploadArchive;
}

export interface ConsumeSourceUploadContext {
  actorPrincipalId: string;
  environmentId?: string | undefined;
  organizationId: string;
  projectId?: string | undefined;
  projectServiceIds?: string[] | undefined;
  sourceUploadId: string;
}

export interface CreatedSourceUpload {
  byteSize: number;
  createdAt: Date;
  environmentId: string | null;
  expiresAt: Date;
  id: string;
  projectId: string | null;
  projectServiceId: string | null;
  sourceDigest: string;
}

export type DeployableSourceUpload = SourceUploadRow;
