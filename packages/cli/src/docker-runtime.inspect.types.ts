import type {
  SystemServiceHealth,
  SystemServiceName,
  SystemServicePublishedPort,
  SystemServiceStatus,
} from '@compartment/contracts';

export type ParsedJsonValue = boolean | number | ParsedJsonObject | ParsedJsonValue[] | string | null;

export interface ParsedJsonObject {
  [key: string]: ParsedJsonValue | undefined;
}

export interface ComposePsServiceEntry {
  containerId: string | null;
  health: SystemServiceHealth | null;
  imageRef: string | null;
  name: SystemServiceName;
  publishedPorts: SystemServicePublishedPort[];
  status: SystemServiceStatus;
}

export interface ComposePsServiceCandidate extends ParsedJsonObject {
  Health?: ParsedJsonValue | undefined;
  ID?: ParsedJsonValue | undefined;
  Image?: ParsedJsonValue | undefined;
  Publishers?: ParsedJsonValue | undefined;
  Service?: ParsedJsonValue | undefined;
  State?: ParsedJsonValue | undefined;
}

export interface DockerInspectHealthCandidate extends ParsedJsonObject {
  Status?: ParsedJsonValue | undefined;
}

export interface DockerInspectStateCandidate extends ParsedJsonObject {
  Health?: DockerInspectHealthCandidate | undefined;
  StartedAt?: ParsedJsonValue | undefined;
  Status?: ParsedJsonValue | undefined;
}

export interface DockerInspectConfigCandidate extends ParsedJsonObject {
  Image?: ParsedJsonValue | undefined;
}

export interface DockerInspectNetworkSettingsCandidate extends ParsedJsonObject {
  Ports?: ParsedJsonObject | undefined;
}

export interface DockerInspectContainerCandidate extends ParsedJsonObject {
  Config?: DockerInspectConfigCandidate | undefined;
  NetworkSettings?: DockerInspectNetworkSettingsCandidate | undefined;
  State?: DockerInspectStateCandidate | undefined;
}
