import { createHash } from 'node:crypto';
import { readDockerImageRepository } from './docker-image-ref';
import type { DockerRegistryCredentials } from './docker-models';

const ociIndexMediaType: string = 'application/vnd.oci.image.index.v1+json';
const ociManifestMediaType: string = 'application/vnd.oci.image.manifest.v1+json';
const attestationReferenceType: string = 'attestation-manifest';
const inTotoMediaType: string = 'application/vnd.in-toto+json';
const spdxPredicateType: string = 'https://spdx.dev/Document';

interface OciDescriptor {
  annotations?: Record<string, string> | undefined;
  digest?: string | undefined;
  mediaType?: string | undefined;
}

type JsonValue = boolean | number | string | null | JsonValue[] | JsonObject;

interface JsonObject {
  [key: string]: JsonValue;
}

interface InTotoStatement {
  _type?: JsonValue | undefined;
  predicate?: JsonValue | undefined;
  predicateType?: JsonValue | undefined;
  subject?: JsonValue | undefined;
}

interface OciIndex {
  manifests?: OciDescriptor[] | undefined;
  mediaType?: string | undefined;
}

interface OciManifest {
  layers?: OciDescriptor[] | undefined;
  mediaType?: string | undefined;
}

interface RegistryManifestTarget {
  reference: string;
  repository: string;
  url: URL;
}

export async function verifyPushedBuildKitSbom(
  imageTag: string,
  digest: string,
  insecureRegistry: boolean,
  credentials: DockerRegistryCredentials | undefined,
): Promise<void> {
  const target: RegistryManifestTarget = registryManifestTarget(imageTag, digest, insecureRegistry);
  const index: OciIndex = await readRegistryJson<OciIndex>(target, ociIndexMediaType, credentials);
  if (await hasSpdxAttestation(target, index, credentials)) {
    return;
  }
  throw new Error(`Expected pushed image ${imageTag}@${digest} to include an SPDX SBOM attestation.`);
}

async function hasSpdxAttestation(
  target: RegistryManifestTarget,
  index: OciIndex,
  credentials: DockerRegistryCredentials | undefined,
): Promise<boolean> {
  for (const descriptor of readAttestationDescriptors(index)) {
    const subjectDigest: string | undefined = descriptor.annotations?.['vnd.docker.reference.digest'];
    if (
      descriptor.digest === undefined ||
      subjectDigest === undefined ||
      !hasImageSubjectDescriptor(index, subjectDigest)
    ) {
      continue;
    }
    const manifest: OciManifest = await readRegistryJson<OciManifest>(
      { ...target, reference: descriptor.digest },
      ociManifestMediaType,
      credentials,
    );
    if (await containsSpdxAttestation(target, manifest, subjectDigest, credentials)) {
      return true;
    }
  }
  return false;
}

function hasImageSubjectDescriptor(index: OciIndex, subjectDigest: string): boolean {
  return (
    index.manifests?.some(
      (descriptor: OciDescriptor): boolean =>
        descriptor.digest === subjectDigest &&
        descriptor.mediaType === ociManifestMediaType &&
        descriptor.annotations?.['vnd.docker.reference.type'] !== attestationReferenceType,
    ) === true
  );
}

function readAttestationDescriptors(index: OciIndex): OciDescriptor[] {
  return index.mediaType === ociIndexMediaType && Array.isArray(index.manifests)
    ? index.manifests.filter(
        (descriptor: OciDescriptor): boolean =>
          descriptor.mediaType === ociManifestMediaType &&
          descriptor.annotations?.['vnd.docker.reference.type'] === attestationReferenceType,
      )
    : [];
}

function registryManifestTarget(
  imageTag: string,
  reference: string,
  insecureRegistry: boolean,
): RegistryManifestTarget {
  const repositoryWithRegistry: string = readDockerImageRepository(imageTag);
  const separator: number = repositoryWithRegistry.indexOf('/');
  if (separator <= 0 || separator === repositoryWithRegistry.length - 1) {
    throw new Error(`Expected pushed image tag "${imageTag}" to include a registry and repository.`);
  }
  const registry: string = repositoryWithRegistry.slice(0, separator);
  const repository: string = repositoryWithRegistry.slice(separator + 1);
  return {
    reference,
    repository,
    url: new URL(`${insecureRegistry ? 'http' : 'https'}://${registry}`),
  };
}

async function readRegistryJson<T>(
  target: RegistryManifestTarget,
  accept: string,
  credentials: DockerRegistryCredentials | undefined,
): Promise<T> {
  return await readRegistryEndpointJson<T>(
    target,
    `manifests/${encodeURIComponent(target.reference)}`,
    credentials,
    target.reference,
    accept,
  );
}

async function containsSpdxAttestation(
  target: RegistryManifestTarget,
  manifest: OciManifest,
  subjectDigest: string,
  credentials: DockerRegistryCredentials | undefined,
): Promise<boolean> {
  if (manifest.mediaType !== ociManifestMediaType || !Array.isArray(manifest.layers)) {
    return false;
  }
  for (const layer of manifest.layers) {
    if (
      layer.digest === undefined ||
      layer.mediaType !== inTotoMediaType ||
      layer.annotations?.['in-toto.io/predicate-type'] !== spdxPredicateType
    ) {
      continue;
    }
    const statement: InTotoStatement = await readRegistryBlobJson<InTotoStatement>(target, layer.digest, credentials);
    if (isSpdxStatementForSubject(statement, subjectDigest)) {
      return true;
    }
  }
  return false;
}

async function readRegistryBlobJson<T>(
  target: RegistryManifestTarget,
  digest: string,
  credentials: DockerRegistryCredentials | undefined,
): Promise<T> {
  return await readRegistryEndpointJson<T>(target, `blobs/${encodeURIComponent(digest)}`, credentials, digest);
}

async function readRegistryEndpointJson<T>(
  target: RegistryManifestTarget,
  path: string,
  credentials: DockerRegistryCredentials | undefined,
  expectedDigest: string,
  accept?: string,
): Promise<T> {
  const url: URL = new URL(`/v2/${target.repository}/${path}`, target.url);
  const response: Response = await fetch(url, {
    headers: { ...registryAuthorizationHeaders(credentials), ...(accept === undefined ? {} : { Accept: accept }) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Could not verify the pushed image SBOM: registry returned HTTP ${response.status}.`);
  }
  const bytes: Buffer = Buffer.from(await response.arrayBuffer());
  assertRegistryDigest(bytes, expectedDigest);
  return JSON.parse(bytes.toString('utf8')) as T;
}

function assertRegistryDigest(bytes: Buffer, expectedDigest: string): void {
  const expectedHash: string | undefined = /^sha256:([a-f0-9]{64})$/u.exec(expectedDigest)?.[1];
  if (expectedHash === undefined || createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
    throw new Error('Could not verify the pushed image SBOM: registry content digest mismatch.');
  }
}

function registryAuthorizationHeaders(credentials: DockerRegistryCredentials | undefined): Record<string, string> {
  return credentials === undefined
    ? {}
    : { Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}` };
}

function isSpdxStatementForSubject(statement: InTotoStatement, subjectDigest: string): boolean {
  const separator: number = subjectDigest.indexOf(':');
  if (separator <= 0 || separator === subjectDigest.length - 1 || !isJsonObject(statement.predicate)) {
    return false;
  }
  const algorithm: string = subjectDigest.slice(0, separator);
  const digest: string = subjectDigest.slice(separator + 1);
  return (
    typeof statement._type === 'string' &&
    statement._type.startsWith('https://in-toto.io/Statement/') &&
    statement.predicateType === spdxPredicateType &&
    typeof statement.predicate.spdxVersion === 'string' &&
    statement.predicate.spdxVersion.startsWith('SPDX-') &&
    statement.predicate.SPDXID === 'SPDXRef-DOCUMENT' &&
    Array.isArray(statement.subject) &&
    statement.subject.some(
      (subject: JsonValue): boolean =>
        isJsonObject(subject) && isJsonObject(subject.digest) && subject.digest[algorithm] === digest,
    )
  );
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
