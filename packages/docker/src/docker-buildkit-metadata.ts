import { readFile } from 'node:fs/promises';
import type {
  BuildKitImageMetadata,
  BuildKitImageMetadataDescriptor,
  BuildKitPushedImageMetadata,
} from './docker-buildkit.types';

export async function readPushedBuildKitImageMetadata(metadataFile: string): Promise<BuildKitPushedImageMetadata> {
  const metadataText: string = await readFile(metadataFile, 'utf8');
  const metadata: BuildKitImageMetadata = parseBuildKitImageMetadata(metadataText);
  const digest: string = readBuildKitImageDigest(metadata);

  return { digest };
}

function parseBuildKitImageMetadata(metadataText: string): BuildKitImageMetadata {
  const parsed: Partial<BuildKitImageMetadata> | null = JSON.parse(
    metadataText,
  ) as Partial<BuildKitImageMetadata> | null;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected BuildKit metadata file to contain a JSON object.');
  }

  return parsed;
}

function readBuildKitImageDigest(metadata: BuildKitImageMetadata): string {
  if (typeof metadata['containerimage.digest'] === 'string' && metadata['containerimage.digest'] !== '') {
    return requireSha256Digest(metadata['containerimage.digest']);
  }

  const descriptor: BuildKitImageMetadataDescriptor | null | undefined = metadata['containerimage.descriptor'];
  if (
    descriptor !== null &&
    descriptor !== undefined &&
    typeof descriptor.digest === 'string' &&
    descriptor.digest !== ''
  ) {
    return requireSha256Digest(descriptor.digest);
  }

  throw new Error('Expected BuildKit metadata to include the pushed image digest.');
}

function requireSha256Digest(digest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error('Expected BuildKit metadata to include a valid SHA-256 image digest.');
  }

  return digest;
}
