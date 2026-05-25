import { dirname, join, relative } from 'node:path';
import {
  type CompartmentAuthoredDescriptor,
  compartmentRoutesFileName,
  normalizeCompartmentSourcePackageRelativePath,
  type CompartmentAuthoredService,
} from '@compartment/contracts';
import { findCommonAncestorPath, findRepositoryBoundary, readBoundaryRealPath } from './source-archive-plan.helpers';
import { readPlannedSourceArchiveTargets } from './source-archive-plan-targets';
import type {
  PlannedSourceArchive,
  PlannedSourceArchiveTargets,
  ResolvedSourceArchiveTarget,
  SelectedSourceArchiveService,
  SourceArchiveDescriptorInput,
} from './source-archive-plan.service.types';
import type { SourceArchiveBuilderInput } from './source-archive.service.types';

export async function planSourceArchive(input: SourceArchiveBuilderInput): Promise<PlannedSourceArchive> {
  const descriptorInput: SourceArchiveDescriptorInput = readSourceArchiveDescriptorInput(input);
  const descriptorDirectory: string = dirname(descriptorInput.descriptorFilePath);
  const boundaryDirectory: string =
    input.repositoryBoundaryDirectory ?? (await findRepositoryBoundary(descriptorDirectory)) ?? descriptorDirectory;
  const boundaryRealPath: string = await readBoundaryRealPath(boundaryDirectory);
  const services: SelectedSourceArchiveService[] = readSelectedDescriptorServices(
    descriptorInput.descriptor,
    input.serviceName,
  );
  const plannedTargets: PlannedSourceArchiveTargets = await readPlannedSourceArchiveTargets(
    descriptorDirectory,
    services,
    boundaryDirectory,
    boundaryRealPath,
  );

  return createPlannedSourceArchive(
    descriptorInput,
    descriptorDirectory,
    boundaryDirectory,
    services,
    plannedTargets.serviceTargets,
    plannedTargets.includeTargets,
  );
}

function readSourceArchiveDescriptorInput(input: SourceArchiveBuilderInput): SourceArchiveDescriptorInput {
  return {
    descriptor: input.descriptor,
    descriptorFilePath: input.descriptorFilePath,
    ...(input.routes !== undefined ? { routes: input.routes } : {}),
  };
}

function createPlannedSourceArchive(
  descriptor: SourceArchiveDescriptorInput,
  descriptorDirectory: string,
  ignoreRoot: string,
  services: readonly SelectedSourceArchiveService[],
  serviceTargets: readonly ResolvedSourceArchiveTarget[],
  includeTargets: readonly ResolvedSourceArchiveTarget[],
): PlannedSourceArchive {
  const archiveRoot: string = readArchiveRoot(descriptor, serviceTargets, includeTargets);

  return {
    archiveRoot,
    archiveRootRelativeToIgnoreRoot: readArchiveEntryPath(ignoreRoot, archiveRoot),
    descriptorDirectoryRelativePath: readArchiveEntryPath(archiveRoot, descriptorDirectory),
    descriptorEntries: readDescriptorEntries(descriptor, archiveRoot),
    ignoreRoot,
    includeEntries: readTargetArchiveEntries(archiveRoot, includeTargets),
    serviceEntries: readTargetArchiveEntries(archiveRoot, serviceTargets),
    servicePaths: readSelectedServicePaths(services),
  };
}

function readSelectedDescriptorServices(
  descriptor: CompartmentAuthoredDescriptor,
  requestedServiceName: string | undefined,
): SelectedSourceArchiveService[] {
  if (requestedServiceName === undefined) {
    return Object.entries(descriptor.services).map(
      ([serviceName, service]: [string, CompartmentAuthoredService]): SelectedSourceArchiveService =>
        normalizeSelectedDescriptorService(serviceName, service),
    );
  }

  const requestedService: CompartmentAuthoredService | undefined = descriptor.services[requestedServiceName];
  if (requestedService === undefined) {
    throw new Error(`Service "${requestedServiceName}" is not defined in compartment.yml.`);
  }

  return [normalizeSelectedDescriptorService(requestedServiceName, requestedService)];
}

function normalizeSelectedDescriptorService(
  serviceName: string,
  service: CompartmentAuthoredService,
): SelectedSourceArchiveService {
  if (typeof service === 'string') {
    return {
      include: [],
      name: serviceName,
      path: service,
    };
  }

  return {
    include: [...(service.build?.include ?? [])],
    name: serviceName,
    path: service.path,
  };
}

function readArchiveRoot(
  descriptor: SourceArchiveDescriptorInput,
  serviceTargets: readonly ResolvedSourceArchiveTarget[],
  includeTargets: readonly ResolvedSourceArchiveTarget[],
): string {
  const archiveRootTargets: string[] = [
    descriptor.descriptorFilePath,
    ...(descriptor.routes !== undefined
      ? [join(dirname(descriptor.descriptorFilePath), compartmentRoutesFileName)]
      : []),
    ...serviceTargets.map((target: ResolvedSourceArchiveTarget): string => target.absolutePath),
    ...includeTargets.map((target: ResolvedSourceArchiveTarget): string => target.absolutePath),
  ];
  const [firstPath, ...remainingPaths]: string[] = archiveRootTargets;
  if (firstPath === undefined) {
    throw new Error('Expected at least one source archive target.');
  }

  return remainingPaths.reduce(findCommonAncestorPath, firstPath);
}

function readDescriptorEntries(descriptor: SourceArchiveDescriptorInput, archiveRoot: string): string[] {
  return [
    readArchiveEntryPath(archiveRoot, descriptor.descriptorFilePath),
    ...(descriptor.routes !== undefined
      ? [readArchiveEntryPath(archiveRoot, join(dirname(descriptor.descriptorFilePath), compartmentRoutesFileName))]
      : []),
  ];
}

function readTargetArchiveEntries(archiveRoot: string, targets: readonly ResolvedSourceArchiveTarget[]): string[] {
  return dedupeArchiveEntries(
    targets.map((target: ResolvedSourceArchiveTarget): string =>
      readArchiveEntryPath(archiveRoot, target.absolutePath),
    ),
  );
}

function readSelectedServicePaths(services: readonly SelectedSourceArchiveService[]): Record<string, string> {
  return Object.fromEntries(
    services.map((service: SelectedSourceArchiveService): [string, string] => [service.name, service.path]),
  );
}

function readArchiveEntryPath(archiveRoot: string, absolutePath: string): string {
  return normalizeCompartmentSourcePackageRelativePath(relative(archiveRoot, absolutePath));
}

function dedupeArchiveEntries(entries: readonly string[]): string[] {
  return [...new Set(entries)].sort((left: string, right: string): number => left.localeCompare(right));
}
