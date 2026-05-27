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
import { canConnectToRuntimeHost } from './runtime-resource-connectivity.service';
import {
  buildResourceContainerName,
  buildResourceOperationContainerName,
  buildRuntimeResourceNetworkName,
} from './runtime-names.service';
import { continueResourceReadinessPolling, resolveResourceReadinessHost } from './runtime-resource-readiness.service';
import { environmentIdLabelName, projectIdLabelName } from './runtime-container-labels';
import { resourceNameLabelName } from './runtime-resource-labels';
import { ensureOwnedRuntimeNetwork } from './runtime-network-ownership.service';
import { resolveRuntimeResourceBackupArtifactHostPath } from './runtime-resource-backup-path.service';
import { buildRuntimeShellCommandContainerInvocation } from './runtime-shell-command.service';
import type { RuntimeResourceOperationConfig } from './runtime.types';

const backupContainerPath: string = '/backup';
type RuntimeResourceOperationMountMode = 'read-only' | 'read-write';

export async function runRuntimeResourceBackupOperation(
  input: NodeResourceOperationRequest,
  config: RuntimeResourceOperationConfig,
): Promise<NodeResourceOperationResponse> {
  return await runRuntimeResourceOperation(input, config, 'read-write');
}

export async function runRuntimeResourceRestoreOperation(
  input: NodeResourceOperationRequest,
  config: RuntimeResourceOperationConfig,
): Promise<NodeResourceOperationResponse> {
  const response: NodeResourceOperationResponse = await runRuntimeResourceOperation(input, config, 'read-only');
  await waitForResourceReadiness(input, config);

  return response;
}

async function runRuntimeResourceOperation(
  input: NodeResourceOperationRequest,
  config: RuntimeResourceOperationConfig,
  mountMode: RuntimeResourceOperationMountMode,
): Promise<NodeResourceOperationResponse> {
  // Fail cheap before setup, then rebuild mounts immediately before Docker create below.
  await buildResourceOperationMounts(input, config.resourceBackupDirectory, mountMode);
  await ensureDockerImageAvailable({
    imageRef: input.definition.image,
    registryCredentials: config.runtimeRegistryCredentials,
  });
  await ensureOwnedRuntimeNetwork({
    dockerNamespace: config.dockerNamespace,
    networkName: buildRuntimeResourceNetworkName(input, config.dockerNamespace),
  });
  const containerInput: DockerRunContainerInput = await buildResourceOperationContainerInput(input, config, mountMode);
  const result: DockerRunContainerToCompletionResult = await runDockerContainerToCompletion(containerInput);

  return {
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

async function buildResourceOperationContainerInput(
  input: NodeResourceOperationRequest,
  config: RuntimeResourceOperationConfig,
  mountMode: RuntimeResourceOperationMountMode,
): Promise<DockerRunContainerInput> {
  return {
    ...buildRuntimeShellCommandContainerInvocation(input.definition.command),
    containerName: buildResourceOperationContainerName(input, config.dockerNamespace),
    env: buildResourceOperationEnv(input),
    imageRef: input.definition.image,
    labels: buildResourceOperationLabels(input, config),
    mounts: await buildResourceOperationMounts(input, config.resourceBackupDirectory, mountMode),
    network: {
      aliases: [],
      name: buildRuntimeResourceNetworkName(input, config.dockerNamespace),
    },
    securityProfile: buildResourceOperationSecurityProfile(),
  };
}

async function buildResourceOperationMounts(
  input: NodeResourceOperationRequest,
  resourceBackupDirectory: string,
  mountMode: RuntimeResourceOperationMountMode,
): Promise<DockerBindMount[]> {
  const hostPath: string = await resolveRuntimeResourceBackupArtifactHostPath(input.backupId, resourceBackupDirectory);

  return [
    {
      containerPath: backupContainerPath,
      hostPath,
      ...(mountMode === 'read-only' ? { readOnly: true } : {}),
    },
  ];
}

function buildResourceOperationSecurityProfile(): DockerContainerSecurityProfile {
  return {
    name: 'restricted-writable',
    writableRootFilesystemReason: 'Resource operation commands may need local scratch space during backup or restore.',
  };
}

function buildResourceOperationLabels(
  input: NodeResourceOperationRequest,
  config: RuntimeResourceOperationConfig,
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
  config: RuntimeResourceOperationConfig,
): Promise<void> {
  if (input.readiness === null) {
    return;
  }

  const readiness: NodeResourceReadiness = input.readiness;
  const deadline: number = Date.now() + readiness.timeoutMs;
  for (;;) {
    if (await canReachRuntimeResourceOperationReadiness(input, config, readiness.port, deadline)) {
      return;
    }
    if (!(await continueResourceReadinessPolling(deadline))) {
      break;
    }
  }

  throw new Error(`Resource ${input.resourceName} did not become ready after restore before ${readiness.timeoutMs}ms.`);
}

async function canReachRuntimeResourceOperationReadiness(
  input: NodeResourceOperationRequest,
  config: RuntimeResourceOperationConfig,
  port: number,
  deadline: number,
): Promise<boolean> {
  return await canReachOperationReadinessPort(
    buildResourceContainerName(input, config.dockerNamespace),
    buildRuntimeResourceNetworkName(input, config.dockerNamespace),
    port,
    deadline,
  );
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
