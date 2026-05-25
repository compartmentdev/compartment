import { relative, resolve } from 'node:path';
import { validateSymlinkFreeFileSystemEntry, type ValidatedFileSystemEntry } from '@compartment/utils';
import { hasVcsMetadataPathSegment } from './source-archive-plan.helpers';
import type {
  PlannedSourceArchiveTargets,
  ResolvedSourceArchiveTarget,
  SelectedSourceArchiveService,
} from './source-archive-plan.service.types';

export async function readPlannedSourceArchiveTargets(
  descriptorDirectory: string,
  services: readonly SelectedSourceArchiveService[],
  boundaryDirectory: string,
  boundaryRealPath: string,
): Promise<PlannedSourceArchiveTargets> {
  const serviceTargets: ResolvedSourceArchiveTarget[] = await readSelectedServiceTargets(
    descriptorDirectory,
    services,
    boundaryDirectory,
    boundaryRealPath,
  );
  const includeTargets: ResolvedSourceArchiveTarget[] = await readSelectedIncludeTargets(
    descriptorDirectory,
    services,
    boundaryDirectory,
    boundaryRealPath,
  );

  return {
    includeTargets,
    serviceTargets,
  };
}

async function readSelectedServiceTargets(
  descriptorDirectory: string,
  services: readonly SelectedSourceArchiveService[],
  boundaryDirectory: string,
  boundaryRealPath: string,
): Promise<ResolvedSourceArchiveTarget[]> {
  return await resolveSourceArchiveTargets(
    descriptorDirectory,
    services.map((service: SelectedSourceArchiveService): string => service.path),
    boundaryDirectory,
    boundaryRealPath,
    'Service path',
    true,
  );
}

async function readSelectedIncludeTargets(
  descriptorDirectory: string,
  services: readonly SelectedSourceArchiveService[],
  boundaryDirectory: string,
  boundaryRealPath: string,
): Promise<ResolvedSourceArchiveTarget[]> {
  return await resolveSourceArchiveTargets(
    descriptorDirectory,
    services.flatMap((service: SelectedSourceArchiveService): string[] => service.include),
    boundaryDirectory,
    boundaryRealPath,
    'build.include path',
    false,
  );
}

async function resolveSourceArchiveTargets(
  descriptorDirectory: string,
  authoredPaths: readonly string[],
  boundaryDirectory: string,
  boundaryRealPath: string,
  label: string,
  requireDirectory: boolean,
): Promise<ResolvedSourceArchiveTarget[]> {
  return await Promise.all(
    authoredPaths.map(
      async (authoredPath: string): Promise<ResolvedSourceArchiveTarget> =>
        await resolveSourceArchiveTarget(
          descriptorDirectory,
          authoredPath,
          boundaryDirectory,
          boundaryRealPath,
          label,
          requireDirectory,
        ),
    ),
  );
}

async function resolveSourceArchiveTarget(
  descriptorDirectory: string,
  authoredPath: string,
  boundaryDirectory: string,
  boundaryRealPath: string,
  label: string,
  requireDirectory: boolean,
): Promise<ResolvedSourceArchiveTarget> {
  const absolutePath: string = resolve(descriptorDirectory, authoredPath);
  const validatedTarget: ValidatedFileSystemEntry = await validateSymlinkFreeFileSystemEntry({
    absolutePath,
    authoredPath,
    boundaryDirectory,
    boundaryLabel: 'the current repository or worktree',
    expectedKind: requireDirectory ? 'directory' : 'any',
    label,
    relativeToLabel: 'the directory containing compartment.yml',
  });
  assertSourceArchiveTargetDoesNotPointToVcsMetadata(authoredPath, validatedTarget.realPath, boundaryRealPath, label);

  return {
    absolutePath,
  };
}

function assertSourceArchiveTargetDoesNotPointToVcsMetadata(
  authoredPath: string,
  targetRealPath: string,
  boundaryRealPath: string,
  label: string,
): void {
  const boundaryRelativePath: string = relative(boundaryRealPath, targetRealPath);
  if (!hasVcsMetadataPathSegment(boundaryRelativePath)) {
    return;
  }

  throw new Error(`${label} "${authoredPath}" cannot target VCS metadata.`);
}
