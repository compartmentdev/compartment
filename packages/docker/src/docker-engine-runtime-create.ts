import type Docker from 'dockerode';
import type {
  DockerContainerNetworkingConfig,
  DockerExposedPortMap,
  DockerExposedPortValue,
} from './docker-engine-runtime.types';
import type {
  DockerBindMount,
  DockerContainerSecurityProfile,
  DockerExtraHost,
  DockerNamedVolumeMount,
  DockerNetworkTarget,
  DockerPublishedPort,
  DockerRunContainerInput,
} from './docker-models';
import { buildDockerRestartPolicy } from './docker-engine-runtime-restart-policy';

interface DockerContainerCreateOptions extends Omit<Docker.ContainerCreateOptions, 'NetworkingConfig'> {
  NetworkingConfig?: DockerContainerNetworkingConfig | undefined;
}

interface DockerHostConfig extends Omit<Docker.HostConfig, 'Mounts'> {
  Mounts?: Docker.MountSettings[] | undefined;
}

export function buildDockerContainerCreateOptions(input: DockerRunContainerInput): Docker.ContainerCreateOptions {
  const networkingConfig: DockerContainerNetworkingConfig | undefined = buildDockerNetworkingConfig(input.network);

  const options: DockerContainerCreateOptions = {
    ...(input.command !== undefined ? { Cmd: input.command } : {}),
    ...(input.entrypoint !== undefined ? { Entrypoint: input.entrypoint } : {}),
    Env: buildDockerEnv(input.env),
    ExposedPorts: buildDockerExposedPorts(input.publishedPorts ?? []),
    HostConfig: buildDockerHostConfig(input),
    Image: input.imageRef,
    Labels: input.labels,
    ...(networkingConfig !== undefined ? { NetworkingConfig: networkingConfig } : {}),
    Tty: false,
    ...buildDockerSecurityContainerConfig(input.securityProfile),
    name: input.containerName,
  };

  return options;
}

function buildDockerHostConfig(input: DockerRunContainerInput): Docker.HostConfig | undefined {
  const hostConfig: DockerHostConfig = {
    Binds: buildDockerBinds(input.mounts ?? []),
    ...buildDockerSecurityHostConfig(input.securityProfile),
    ExtraHosts: buildDockerExtraHosts(input.extraHosts ?? []),
    Mounts: buildDockerNamedVolumeMounts(input.namedVolumes ?? []),
    NetworkMode: readDockerNetworkMode(input.network),
    PortBindings: buildDockerPortBindings(input.publishedPorts ?? []),
    RestartPolicy: input.restartPolicy !== undefined ? buildDockerRestartPolicy(input.restartPolicy) : undefined,
  };

  return hasDockerHostConfig(hostConfig) ? hostConfig : undefined;
}

function hasDockerHostConfig(hostConfig: DockerHostConfig): boolean {
  return (
    hostConfig.Binds !== undefined ||
    hostConfig.CapAdd !== undefined ||
    hostConfig.CapDrop !== undefined ||
    hostConfig.ExtraHosts !== undefined ||
    hostConfig.Mounts !== undefined ||
    hostConfig.NetworkMode !== undefined ||
    hostConfig.Privileged !== undefined ||
    hostConfig.PortBindings !== undefined ||
    hostConfig.ReadonlyRootfs !== undefined ||
    hostConfig.RestartPolicy !== undefined ||
    hostConfig.SecurityOpt !== undefined ||
    hostConfig.Tmpfs !== undefined
  );
}

function buildDockerSecurityHostConfig(profile: DockerContainerSecurityProfile): DockerHostConfig {
  if (profile.name === 'privileged-writable') {
    return {
      Privileged: true,
      SecurityOpt: ['no-new-privileges:true'],
    };
  }

  return {
    ...(profile.capabilityAdditions !== undefined ? { CapAdd: profile.capabilityAdditions.add } : {}),
    CapDrop: ['ALL'],
    ReadonlyRootfs: profile.name === 'restricted-readonly',
    SecurityOpt: ['no-new-privileges:true'],
    ...(profile.name === 'restricted-readonly' && profile.tmpfs !== undefined
      ? { Tmpfs: buildDockerTmpfs(profile.tmpfs) }
      : {}),
  };
}

function buildDockerTmpfs(tmpfs: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    tmpfs.map((value: string): [string, string] => {
      const [path, options = ''] = value.split(':', 2);
      if (path === undefined || path === '') {
        throw new Error(`Invalid Docker tmpfs mount "${value}".`);
      }

      return [path, options];
    }),
  );
}

function buildDockerSecurityContainerConfig(
  profile: DockerContainerSecurityProfile,
): Pick<Docker.ContainerCreateOptions, 'User'> {
  if (profile.name === 'privileged-writable' || profile.user === undefined) {
    return {};
  }

  return {
    User: profile.user,
  };
}

function buildDockerNamedVolumeMounts(namedVolumes: DockerNamedVolumeMount[]): Docker.MountSettings[] | undefined {
  if (namedVolumes.length === 0) {
    return undefined;
  }

  return namedVolumes.map(
    (volume: DockerNamedVolumeMount): Docker.MountSettings => ({
      Source: volume.name,
      Target: volume.targetPath,
      Type: 'volume',
    }),
  );
}

function buildDockerNetworkingConfig(
  network: DockerNetworkTarget | undefined,
): DockerContainerNetworkingConfig | undefined {
  if (network === undefined || typeof network === 'string') {
    return undefined;
  }

  return {
    EndpointsConfig: {
      [network.name]: {
        ...(network.aliases !== undefined ? { Aliases: network.aliases } : {}),
      },
    },
  };
}

function readDockerNetworkMode(network: DockerNetworkTarget | undefined): string | undefined {
  if (network === undefined || typeof network === 'string') {
    return network;
  }

  return network.name;
}

function buildDockerPortBindings(publishedPorts: DockerPublishedPort[]): Docker.PortMap | undefined {
  if (publishedPorts.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    publishedPorts.map((binding: DockerPublishedPort): [string, Docker.PortBinding[]] => [
      readDockerPortKey(binding.containerPort),
      [
        {
          HostIp: binding.hostIp ?? '0.0.0.0',
          HostPort: binding.hostPort.toString(),
        },
      ],
    ]),
  );
}

function buildDockerExposedPorts(publishedPorts: DockerPublishedPort[]): DockerExposedPortMap | undefined {
  if (publishedPorts.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    publishedPorts.map((binding: DockerPublishedPort): [string, DockerExposedPortValue] => [
      readDockerPortKey(binding.containerPort),
      {},
    ]),
  );
}

function buildDockerExtraHosts(extraHosts: DockerExtraHost[]): string[] | undefined {
  if (extraHosts.length === 0) {
    return undefined;
  }

  return extraHosts.map((extraHost: DockerExtraHost): string => `${extraHost.host}:${extraHost.target}`);
}

function buildDockerBinds(mounts: DockerBindMount[]): string[] | undefined {
  if (mounts.length === 0) {
    return undefined;
  }

  return mounts.map((mount: DockerBindMount): string =>
    mount.readOnly === true
      ? `${mount.hostPath}:${mount.containerPath}:ro`
      : `${mount.hostPath}:${mount.containerPath}`,
  );
}

function buildDockerEnv(runtimeEnv: Record<string, string>): string[] {
  return Object.entries(runtimeEnv).map(([name, value]: [string, string]): string => `${name}=${value}`);
}

function readDockerPortKey(containerPort: number): string {
  return `${containerPort.toString()}/tcp`;
}
