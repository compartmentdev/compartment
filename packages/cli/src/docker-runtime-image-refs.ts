import type { SystemServiceName } from '@compartment/contracts';
import type { CommandResult } from './command-runner.types';
import { runDockerCommand } from './docker-command';
import { selfHostedCoreRuntimeServiceNames } from './docker-runtime.service-names';
import type { DockerExecutionContext } from './docker-runtime.types';
import type { SelfHostedImageRefs } from './self-hosted-env.types';

const mutableRegistryImageTags: ReadonlySet<string> = new Set<string>(['latest', 'main']);
const postgresBackedSelfHostedRuntimeServiceNames: readonly SystemServiceName[] = ['api', 'edge', 'caddy'];
const thirdPartySelfHostedRuntimeImageRefs: ReadonlyMap<SystemServiceName, string> = new Map<SystemServiceName, string>(
  [
    ['builder', 'moby/buildkit:v0.30.0'],
    ['postgres', 'postgres:16'],
    ['registry', 'registry:2'],
  ],
);

export async function readMissingSelfHostedRuntimeImageRefs(
  context: DockerExecutionContext,
  imageRefs: SelfHostedImageRefs,
): Promise<string[]> {
  return await readMissingDockerImageRefs(context, readRequiredRuntimeImageRefs(imageRefs));
}

export async function readMissingDockerImageRefs(
  context: DockerExecutionContext,
  imageRefs: readonly string[],
): Promise<string[]> {
  const missingImageRefs: string[] = [];

  for (const imageRef of imageRefs) {
    const inspectResult: CommandResult = await runDockerCommand(context, ['image', 'inspect', imageRef]);
    if (inspectResult.exitCode !== 0) {
      missingImageRefs.push(imageRef);
    }
  }

  return missingImageRefs;
}

export function usesMutableRegistryImageTag(imageRefs: SelfHostedImageRefs): boolean {
  return readCoreRuntimeImageRefs(imageRefs).some((imageRef: string): boolean =>
    mutableRegistryImageTags.has(readImageTag(imageRef)),
  );
}

function readRequiredRuntimeImageRefs(imageRefs: SelfHostedImageRefs): string[] {
  return [
    ...readCoreRuntimeImageRefs(imageRefs),
    ...readThirdPartySelfHostedRuntimeImageRefs(selfHostedCoreRuntimeServiceNames, true),
  ];
}

function readCoreRuntimeImageRefs(imageRefs: SelfHostedImageRefs): string[] {
  return [
    imageRefs.apiImage,
    imageRefs.caddyImage,
    imageRefs.edgeImage,
    imageRefs.runtimeProbeImage,
    imageRefs.workerImage,
  ];
}

export function readThirdPartySelfHostedRuntimeImageRefs(
  services: readonly SystemServiceName[],
  includeDependencies: boolean,
): string[] {
  const serviceNames: Set<SystemServiceName> = new Set<SystemServiceName>();

  for (const serviceName of services) {
    if (thirdPartySelfHostedRuntimeImageRefs.has(serviceName)) {
      serviceNames.add(serviceName);
    }
  }

  if (includeDependencies && services.some(usesPostgresDependency)) {
    serviceNames.add('postgres');
  }
  if (includeDependencies && services.includes('worker')) {
    serviceNames.add('builder');
  }

  return [...serviceNames].map(readRequiredThirdPartySelfHostedRuntimeImageRef);
}

function readRequiredThirdPartySelfHostedRuntimeImageRef(serviceName: SystemServiceName): string {
  const imageRef: string | undefined = thirdPartySelfHostedRuntimeImageRefs.get(serviceName);
  if (imageRef === undefined) {
    throw new Error(`Missing fixed self-hosted runtime image ref for ${serviceName}.`);
  }

  return imageRef;
}

function usesPostgresDependency(serviceName: SystemServiceName): boolean {
  return postgresBackedSelfHostedRuntimeServiceNames.includes(serviceName);
}

function readImageTag(imageRef: string): string {
  const digestSeparatorIndex: number = imageRef.indexOf('@');
  const tagSource: string = digestSeparatorIndex === -1 ? imageRef : imageRef.slice(0, digestSeparatorIndex);
  const lastSlashIndex: number = tagSource.lastIndexOf('/');
  const lastColonIndex: number = tagSource.lastIndexOf(':');

  if (lastColonIndex <= lastSlashIndex) {
    return '';
  }

  return tagSource.slice(lastColonIndex + 1);
}
