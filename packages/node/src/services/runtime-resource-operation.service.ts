import {
  buildDockerNamespaceLabels,
  ensureDockerImageAvailable,
  runDockerContainerToCompletion,
  type DockerBindMount,
  type DockerContainerSecurityProfile,
  type DockerRunContainerInput,
  type DockerRunContainerToCompletionResult,
} from '@compartment/docker';
import type {
  NodeResourceEnvValue,
  NodeResourceOperationRequest,
  NodeResourceOperationResponse,
  NodeResourceReadiness,
} from '@compartment/contracts';
import type { RuntimeDeployConfig } from './runtime.types';
import { canConnectToRuntimeHost } from './runtime-resource-connectivity.service';
import {
  buildResourceContainerName,
  buildResourceOperationContainerName,
  buildRuntimeResourceNetworkName,
} from './runtime-names.service';
import { resolveResourceReadinessHost, resourceReadinessPollIntervalMs } from './runtime-resource-readiness.service';
import { environmentIdLabelName, projectIdLabelName } from './runtime-container-labels';
import { resourceNameLabelName } from './runtime-resource-labels';
import { ensureOwnedRuntimeNetwork } from './runtime-network-ownership.service';

const backupContainerPath: string = '/backup';

export async function runRuntimeResourceBackupOperation(
  input: NodeResourceOperationRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceOperationResponse> {
  return await runRuntimeResourceOperation(input, config);
}

export async function runRuntimeResourceRestoreOperation(
  input: NodeResourceOperationRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceOperationResponse> {
  const response: NodeResourceOperationResponse = await runRuntimeResourceOperation(input, config);
  await waitForResourceReadiness(input, config);

  return response;
}

async function runRuntimeResourceOperation(
  input: NodeResourceOperationRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceOperationResponse> {
  await ensureDockerImageAvailable({
    imageRef: input.definition.image,
    registryCredentials: config.runtimeRegistryCredentials,
  });
  await ensureOwnedRuntimeNetwork({
    dockerNamespace: config.dockerNamespace,
    networkName: buildRuntimeResourceNetworkName(input, config.dockerNamespace),
  });
  const result: DockerRunContainerToCompletionResult = await runDockerContainerToCompletion(
    buildResourceOperationContainerInput(input, config),
  );

  return {
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function buildResourceOperationContainerInput(
  input: NodeResourceOperationRequest,
  config: RuntimeDeployConfig,
): DockerRunContainerInput {
  return {
    command: ['sh', '-lc', input.definition.command],
    containerName: buildResourceOperationContainerName(input, config.dockerNamespace),
    env: buildResourceOperationEnv(input),
    imageRef: input.definition.image,
    labels: buildResourceOperationLabels(input, config),
    mounts: buildResourceOperationMounts(input),
    network: {
      aliases: [],
      name: buildRuntimeResourceNetworkName(input, config.dockerNamespace),
    },
    securityProfile: buildResourceOperationSecurityProfile(),
  };
}

function buildResourceOperationMounts(input: NodeResourceOperationRequest): DockerBindMount[] {
  return [
    {
      containerPath: backupContainerPath,
      hostPath: input.artifactHostPath,
    },
  ];
}

function buildResourceOperationSecurityProfile(): DockerContainerSecurityProfile {
  return {
    name: 'restricted-writable',
    writableRootFilesystemReason: 'Resource backup and restore commands write to the mounted backup directory.',
  };
}

function buildResourceOperationLabels(
  input: NodeResourceOperationRequest,
  config: RuntimeDeployConfig,
): Record<string, string> {
  return {
    ...buildDockerNamespaceLabels(config.dockerNamespace),
    [environmentIdLabelName]: input.environmentId,
    [projectIdLabelName]: input.projectId,
    'compartment.environment': input.environmentName,
    'compartment.project': input.projectName,
    [resourceNameLabelName]: input.resourceName,
  };
}

function buildResourceOperationEnv(input: NodeResourceOperationRequest): Record<string, string> {
  return {
    ...Object.fromEntries(
      input.definition.env.map((value: NodeResourceEnvValue): [string, string] => [value.keyName, value.value]),
    ),
    COMPARTMENT_BACKUP_DIR: backupContainerPath,
    COMPARTMENT_ENVIRONMENT_NAME: input.environmentName,
    COMPARTMENT_PROJECT_NAME: input.projectName,
    COMPARTMENT_RESOURCE_HOST: input.resourceHostname,
    COMPARTMENT_RESOURCE_NAME: input.resourceName,
  };
}

async function waitForResourceReadiness(
  input: NodeResourceOperationRequest,
  config: RuntimeDeployConfig,
): Promise<void> {
  if (input.readiness === null) {
    return;
  }

  const readiness: NodeResourceReadiness = input.readiness;
  const deadline: number = Date.now() + readiness.timeoutMs;
  const resourceNetworkName: string = buildRuntimeResourceNetworkName(input, config.dockerNamespace);
  const resourceContainerName: string = buildResourceContainerName(input, config.dockerNamespace);
  while (Date.now() <= deadline) {
    if (await canReachOperationReadinessPort(resourceContainerName, resourceNetworkName, readiness.port, deadline)) {
      return;
    }
    await waitForResourceReadinessPoll();
  }

  throw new Error(`Resource ${input.resourceName} did not become ready after restore before ${readiness.timeoutMs}ms.`);
}

async function canReachOperationReadinessPort(
  resourceContainerName: string,
  resourceNetworkName: string,
  port: number,
  deadline: number,
): Promise<boolean> {
  const readinessHost: string | null = await resolveOperationReadinessHost(resourceContainerName, resourceNetworkName);
  return readinessHost !== null && (await canConnectToRuntimeHost(readinessHost, port, deadline));
}

async function resolveOperationReadinessHost(
  resourceContainerName: string,
  resourceNetworkName: string,
): Promise<string | null> {
  try {
    return await resolveResourceReadinessHost(resourceContainerName, resourceNetworkName);
  } catch {
    return null;
  }
}

async function waitForResourceReadinessPoll(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, resourceReadinessPollIntervalMs);
  });
}
