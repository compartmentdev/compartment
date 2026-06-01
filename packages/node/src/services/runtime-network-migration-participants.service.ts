import {
  inspectDockerContainer,
  type DockerInspectContainerResult,
  type DockerInspectNetworkResult,
  type DockerNetworkAttachment,
} from '@compartment/docker';
import { deploymentIdLabelName, releaseContainerLabelName, upstreamHostLabelName } from './runtime-container-labels';

export interface RuntimeNetworkMigrationParticipant {
  aliases?: string[] | undefined;
  containerId: string;
}

type RuntimeNetworkMigrationKind = 'resource' | 'service';

export async function readRuntimeNetworkMigrationParticipants(
  network: DockerInspectNetworkResult,
  kind: RuntimeNetworkMigrationKind,
): Promise<RuntimeNetworkMigrationParticipant[]> {
  const participants: RuntimeNetworkMigrationParticipant[] = [];
  for (const containerId of network.endpointContainerIds) {
    const container: DockerInspectContainerResult | null = await inspectDockerContainer({ containerRef: containerId });
    if (container === null) {
      continue;
    }

    participants.push({
      ...readRuntimeNetworkMigrationParticipantAliases(container, network.name, kind),
      containerId,
    });
  }

  return participants;
}

function readRuntimeNetworkMigrationParticipantAliases(
  container: DockerInspectContainerResult,
  networkName: string,
  kind: RuntimeNetworkMigrationKind,
): Pick<RuntimeNetworkMigrationParticipant, 'aliases'> {
  const existingAliases: string[] | undefined = readRuntimeNetworkAttachmentAliases(container, networkName);
  if (existingAliases !== undefined) {
    return { aliases: existingAliases };
  }

  if (kind !== 'service') {
    return {};
  }

  const serviceAlias: string | undefined = readServiceRuntimeNetworkAlias(container);
  return serviceAlias === undefined ? {} : { aliases: [serviceAlias] };
}

function readRuntimeNetworkAttachmentAliases(
  container: DockerInspectContainerResult,
  networkName: string,
): string[] | undefined {
  const attachment: DockerNetworkAttachment | undefined = container.networkAttachments?.find(
    (candidate: DockerNetworkAttachment): boolean => candidate.name === networkName,
  );
  const aliases: string[] = [...new Set<string>(attachment?.aliases ?? [])].filter(hasText);
  return aliases.length === 0 ? undefined : aliases;
}

function readServiceRuntimeNetworkAlias(container: DockerInspectContainerResult): string | undefined {
  if (container.labels[releaseContainerLabelName] === 'true' || !hasText(container.labels[deploymentIdLabelName])) {
    return undefined;
  }

  return hasText(container.labels[upstreamHostLabelName]) ? container.labels[upstreamHostLabelName] : undefined;
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}
