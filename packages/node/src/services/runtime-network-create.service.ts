import {
  ensureDockerNetwork,
  inspectDockerNetwork,
  isDockerNetworkIpamCapacityError,
  readDockerEngineErrorMessage,
  type DockerEngineError,
  type DockerInspectNetworkResult,
} from '@compartment/docker';
import { createRuntimeDockerError, createRuntimeNetworkCapacityExhaustedError } from '../errors/node-runtime-error';
import { formatIpv4Cidr, type Ipv4Cidr } from './runtime-network-cidr.service';
import { assertCompatibleExistingRuntimeNetwork, buildRuntimeNetworkLabels } from './runtime-network-managed.service';
import type {
  RuntimeNetworkCapacityConfig,
  RuntimeNetworkCreateInput,
  RuntimeNetworkSpec,
} from './runtime-network-capacity.types';
import { assertRuntimeNetworkSubnetEndpointCapacity } from './runtime-network-endpoint-capacity.service';
import {
  allocateRuntimeNetworkSubnet,
  allocateRuntimeNetworkSubnetAvoiding,
} from './runtime-network-subnet-allocation.service';

const runtimeNetworkCreateMaxAttempts: number = 3;
const newServiceNetworkRequiredEndpointCount: number = 2;
const newResourceNetworkRequiredEndpointCount: number = 1;

interface RuntimeNetworkCreateAttemptResult {
  error?: DockerEngineError | undefined;
  created: boolean;
}

export async function ensureRuntimeNetwork(
  input: RuntimeNetworkCreateInput,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({
    networkName: input.spec.networkName,
  });
  if (network !== null) {
    assertCompatibleExistingRuntimeNetwork(input.spec, network, config);
    return;
  }

  const subnet: Ipv4Cidr = await allocateRuntimeNetworkSubnet(config.runtimeNetworkPool);
  assertNewRuntimeNetworkEndpointCapacity(
    input.spec,
    subnet,
    readDefaultNewRuntimeNetworkRequiredEndpointCount(input.spec),
  );
  await createManagedRuntimeNetwork(input, config, subnet);
}

export async function createManagedRuntimeNetwork(
  input: RuntimeNetworkCreateInput,
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
): Promise<void> {
  let candidateSubnet: Ipv4Cidr = subnet;
  const failedSubnets: Ipv4Cidr[] = [];
  let lastError: DockerEngineError | undefined;
  for (let attempt: number = 1; attempt <= runtimeNetworkCreateMaxAttempts; attempt += 1) {
    const result: RuntimeNetworkCreateAttemptResult = await createManagedRuntimeNetworkCandidate(
      input,
      config,
      candidateSubnet,
    );
    if (result.created) {
      return;
    }
    lastError = result.error;
    candidateSubnet = await readNextRuntimeNetworkCreateCandidate(config, candidateSubnet, failedSubnets, attempt);
  }

  throwRuntimeNetworkCreateFailure(lastError);
}

async function createManagedRuntimeNetworkCandidate(
  input: RuntimeNetworkCreateInput,
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
): Promise<RuntimeNetworkCreateAttemptResult> {
  assertNewRuntimeNetworkEndpointCapacity(
    input.spec,
    subnet,
    readDefaultNewRuntimeNetworkRequiredEndpointCount(input.spec),
  );
  return await tryCreateManagedRuntimeNetwork(input, config, subnet);
}

export function assertNewRuntimeNetworkEndpointCapacity(
  spec: RuntimeNetworkSpec,
  subnet: Ipv4Cidr,
  requiredEndpoints: number,
): void {
  assertRuntimeNetworkSubnetEndpointCapacity({
    networkName: spec.networkName,
    reason: `new ${spec.kind} runtime network`,
    requiredEndpoints,
    subnet,
  });
}

async function tryCreateManagedRuntimeNetwork(
  input: RuntimeNetworkCreateInput,
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
): Promise<RuntimeNetworkCreateAttemptResult> {
  try {
    await ensureDockerNetwork({
      ipam: { subnet: formatIpv4Cidr(subnet) },
      labels: buildRuntimeNetworkLabels(input, config, subnet),
      networkName: input.spec.networkName,
    });
    return { created: true };
  } catch (error) {
    const dockerError: DockerEngineError = error as DockerEngineError;
    if (!isDockerNetworkIpamCapacityError(dockerError)) {
      throw createRuntimeDockerError(readDockerErrorMessage(dockerError));
    }
    return { created: false, error: dockerError };
  }
}

async function readNextRuntimeNetworkCreateCandidate(
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
  failedSubnets: Ipv4Cidr[],
  attempt: number,
): Promise<Ipv4Cidr> {
  failedSubnets.push(subnet);
  return attempt >= runtimeNetworkCreateMaxAttempts
    ? subnet
    : await allocateRuntimeNetworkSubnetAvoiding(config.runtimeNetworkPool, failedSubnets);
}

function throwRuntimeNetworkCreateFailure(lastError: DockerEngineError | undefined): never {
  if (lastError !== undefined && isDockerNetworkIpamCapacityError(lastError)) {
    throw createRuntimeNetworkCapacityExhaustedError(readDockerErrorMessage(lastError));
  }

  throw createRuntimeNetworkCapacityExhaustedError('No managed runtime network subnets are available.');
}

function readDefaultNewRuntimeNetworkRequiredEndpointCount(spec: RuntimeNetworkSpec): number {
  return spec.kind === 'service' ? newServiceNetworkRequiredEndpointCount : newResourceNetworkRequiredEndpointCount;
}

function readDockerErrorMessage(error: DockerEngineError): string {
  const message: string = readDockerEngineErrorMessage(error);
  return message === '' ? 'Docker Engine rejected runtime network creation.' : message;
}
