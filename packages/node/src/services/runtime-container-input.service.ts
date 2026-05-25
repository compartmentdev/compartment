import {
  type DockerNetworkTarget,
  type DockerPublishedPort,
  type DockerRestartPolicy,
  type DockerRunContainerInput,
} from '@compartment/docker';
import type { NodeDeployRequest, ResolvedCompartmentServiceRestartConfig } from '@compartment/contracts';
import { buildRuntimeContainerLabels } from './runtime-container-labels';
import { loopbackRuntimePublishHost } from './runtime-publish.constants';
import { buildUserApplicationWritableSecurityProfile } from './runtime-security-profile.service';
import type { ResolvedRuntimeDeploymentContext } from './runtime.types';

export function buildRuntimeContainerInput(
  input: NodeDeployRequest,
  context: ResolvedRuntimeDeploymentContext,
): DockerRunContainerInput {
  const network: DockerNetworkTarget | undefined = buildRuntimeContainerNetwork(context);

  return {
    containerName: context.containerName,
    ...(context.runtimeCommand !== undefined ? { command: context.runtimeCommand } : {}),
    env: context.runtimeEnv,
    imageRef: input.imageRef,
    labels: buildRuntimeContainerLabels(context, input),
    ...(network !== undefined ? { network } : {}),
    ...(context.publishedPort !== undefined
      ? { publishedPorts: [buildRuntimePublishedPort(context, context.publishedPort)] }
      : {}),
    restartPolicy: buildDockerRestartPolicy(input.run.restart),
    securityProfile: buildUserApplicationWritableSecurityProfile(
      'User runtime images can require writable paths outside declared volumes.',
    ),
  };
}

function buildRuntimeContainerNetwork(context: ResolvedRuntimeDeploymentContext): DockerNetworkTarget | undefined {
  if (context.networkName === undefined) {
    return undefined;
  }

  return {
    ...(context.networkAliases !== undefined ? { aliases: context.networkAliases } : {}),
    name: context.networkName,
  };
}

function buildDockerRestartPolicy(restart: ResolvedCompartmentServiceRestartConfig): DockerRestartPolicy {
  return {
    ...(restart.maxRetries !== undefined ? { maximumRetryCount: restart.maxRetries } : {}),
    name: restart.policy,
  };
}

function buildRuntimePublishedPort(
  context: ResolvedRuntimeDeploymentContext,
  publishedPort: number,
): DockerPublishedPort {
  return {
    containerPort: context.containerPort,
    hostIp: loopbackRuntimePublishHost,
    hostPort: publishedPort,
  };
}
