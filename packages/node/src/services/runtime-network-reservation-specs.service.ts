import type { NodeRuntimeNetworkReservationRequest } from '@compartment/contracts';
import type { RuntimeNetworkCapacityConfig, RuntimeNetworkSpec } from './runtime-network-capacity.types';
import { buildRuntimeResourceNetworkName, buildRuntimeServiceNetworkName } from './runtime-names.service';

export type RuntimeServiceNetworkSpecInput = Pick<
  NodeRuntimeNetworkReservationRequest,
  'environmentId' | 'projectId' | 'serviceId'
>;

export type RuntimeResourceNetworkSpecInput = Pick<NodeRuntimeNetworkReservationRequest, 'environmentId' | 'projectId'>;

export function buildRuntimeNetworkReservationSpecs(
  input: NodeRuntimeNetworkReservationRequest,
  config: RuntimeNetworkCapacityConfig,
): RuntimeNetworkSpec[] {
  return [
    ...buildServiceNetworkReservationSpecs(input, config),
    ...buildResourceNetworkReservationSpecs(input, config),
  ];
}

function buildServiceNetworkReservationSpecs(
  input: NodeRuntimeNetworkReservationRequest,
  config: RuntimeNetworkCapacityConfig,
): RuntimeNetworkSpec[] {
  if (config.runtimeConnectivityMode !== 'network') {
    return [];
  }

  return [buildRuntimeServiceNetworkSpec(input, config)];
}

function buildResourceNetworkReservationSpecs(
  input: NodeRuntimeNetworkReservationRequest,
  config: RuntimeNetworkCapacityConfig,
): RuntimeNetworkSpec[] {
  if (!input.requiresResourceNetwork) {
    return [];
  }

  return [buildRuntimeResourceNetworkSpec(input, config)];
}

export function buildRuntimeServiceNetworkSpec(
  input: RuntimeServiceNetworkSpecInput,
  config: RuntimeNetworkCapacityConfig,
): RuntimeNetworkSpec {
  return {
    environmentId: input.environmentId,
    kind: 'service',
    networkName: buildRuntimeServiceNetworkName(input, config.dockerNamespace),
    projectId: input.projectId,
    serviceId: input.serviceId,
  };
}

export function buildRuntimeResourceNetworkSpec(
  input: RuntimeResourceNetworkSpecInput,
  config: RuntimeNetworkCapacityConfig,
): RuntimeNetworkSpec {
  return {
    environmentId: input.environmentId,
    kind: 'resource',
    networkName: buildRuntimeResourceNetworkName(input, config.dockerNamespace),
    projectId: input.projectId,
  };
}
