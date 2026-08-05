import type { KubeContainerSecurityContext, KubePodSecurityContext } from './kube-security-context.types';

const postgresAlpineImagePattern: RegExp = /^postgres:(?:alpine|[^@]+-alpine)(?:[0-9]+(?:\.[0-9]+)*)?(?:@|$)/u;
const projectRuntimeUserId: number = 10_001;
const postgresAlpineRuntimeUserId: number = 70;
const postgresDebianRuntimeUserId: number = 999;
const gvisorBuildKitCapabilities: string[] = [
  'AUDIT_WRITE',
  'CHOWN',
  'DAC_OVERRIDE',
  'FOWNER',
  'FSETID',
  'KILL',
  'MKNOD',
  'NET_BIND_SERVICE',
  'NET_RAW',
  'SETFCAP',
  'SETGID',
  'SETPCAP',
  'SETUID',
  'SYS_ADMIN',
  'SYS_CHROOT',
];

export function gvisorBuildKitSecurityContext(): KubeContainerSecurityContext {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { add: gvisorBuildKitCapabilities, drop: ['ALL'] },
    privileged: false,
    readOnlyRootFilesystem: true,
    runAsGroup: 0,
    runAsUser: 0,
  };
}

export function gvisorBuildRunnerSecurityContext(): KubeContainerSecurityContext {
  return {
    ...restrictedContainerSecurityContext(),
    readOnlyRootFilesystem: true,
    runAsGroup: projectRuntimeUserId,
    runAsNonRoot: true,
    runAsUser: projectRuntimeUserId,
  };
}

export function restrictedContainerSecurityContext(): KubeContainerSecurityContext {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    privileged: false,
  };
}

export function projectPodSecurityContext(): KubePodSecurityContext {
  return restrictedPodSecurityContext(projectRuntimeUserId);
}

export function projectVolumeSecurityContext(): KubePodSecurityContext {
  return {
    fsGroup: projectRuntimeUserId,
    fsGroupChangePolicy: 'Always',
  };
}

export function resourcePodSecurityContext(image: string): KubePodSecurityContext {
  const runtimeUserId: number = resourceRuntimeUserId(image) ?? projectRuntimeUserId;
  return {
    ...restrictedPodSecurityContext(runtimeUserId),
    fsGroup: runtimeUserId,
    fsGroupChangePolicy: 'Always',
  };
}

function resourceRuntimeUserId(image: string): number | undefined {
  if (!isPostgresResourceImage(image)) {
    return undefined;
  }
  const imageName: string = resourceImageName(image);
  if (postgresAlpineImagePattern.test(imageName)) {
    return postgresAlpineRuntimeUserId;
  }
  return postgresDebianRuntimeUserId;
}

export function isPostgresResourceImage(image: string): boolean {
  const versionSeparatorIndex: number = image.search(/[:@]/u);
  const repository: string = versionSeparatorIndex === -1 ? image : image.slice(0, versionSeparatorIndex);
  const isOfficialRepository: boolean =
    repository === 'postgres' ||
    repository === 'docker.io/library/postgres' ||
    repository === 'index.docker.io/library/postgres' ||
    repository === 'registry-1.docker.io/library/postgres';
  const version: string = versionSeparatorIndex === -1 ? '' : image.slice(versionSeparatorIndex);
  return isOfficialRepository && !version.startsWith('@');
}

function resourceImageName(image: string): string {
  return image.slice(image.lastIndexOf('/') + 1);
}

function restrictedPodSecurityContext(runtimeUserId: number): KubePodSecurityContext {
  return {
    runAsGroup: runtimeUserId,
    runAsNonRoot: true,
    runAsUser: runtimeUserId,
    seccompProfile: { type: 'RuntimeDefault' },
  };
}
