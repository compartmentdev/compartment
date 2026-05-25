import type { DockerContainerCapability, DockerContainerSecurityProfile } from '@compartment/docker';

const rootEntrypointCompatibilityCapabilities: DockerContainerCapability[] = [
  'CHOWN',
  'NET_BIND_SERVICE',
  'SETGID',
  'SETUID',
];

const resourceEntrypointVolumeCompatibilityCapabilities: DockerContainerCapability[] = [
  'CHOWN',
  'DAC_OVERRIDE',
  'FOWNER',
  'SETGID',
  'SETUID',
];

export function buildUserApplicationWritableSecurityProfile(
  writableRootFilesystemReason: string,
): DockerContainerSecurityProfile {
  return {
    capabilityAdditions: {
      add: rootEntrypointCompatibilityCapabilities,
      reason:
        'User app images can use root entrypoints to prepare writable paths, bind low ports, then drop privileges.',
    },
    name: 'restricted-writable',
    writableRootFilesystemReason,
  };
}

export function buildUserResourceWritableSecurityProfile(
  writableRootFilesystemReason: string,
): DockerContainerSecurityProfile {
  return {
    capabilityAdditions: {
      add: resourceEntrypointVolumeCompatibilityCapabilities,
      reason:
        'User resource images can use root entrypoints to repair persistent volume ownership and permissions, then drop privileges.',
    },
    name: 'restricted-writable',
    writableRootFilesystemReason,
  };
}
