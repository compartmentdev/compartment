export interface SourceUploadRow {
  byteSize: number;
  consumedAt: Date | null;
  createdAt: Date;
  createdByPrincipalId: string | null;
  environmentId: string | null;
  expiresAt: Date;
  id: string;
  organizationId: string;
  projectId: string | null;
  projectServiceId: string | null;
  sourceDigest: string;
}

export interface CreateSourceUploadInput {
  archiveBase64: string;
  byteSize: number;
  createdByPrincipalId: string;
  environmentId: string | null;
  expiresAt: Date;
  id: string;
  organizationId: string;
  projectId: string | null;
  projectServiceId: string | null;
  sourceDigest: string;
}

export interface SourceUploadConsumptionScopeInput {
  actorPrincipalId: string;
  environmentId: string;
  organizationId: string;
  projectId: string;
  projectServiceIds: string[];
  sourceUploadId: string;
}

export interface SourceUploadLookupInput {
  organizationId: string;
  sourceUploadId: string;
}
