export type DockerBuildPacker = 'dockerfile' | 'railpack' | 'static';
export type DockerLogStream = 'stdout' | 'stderr';

export interface DockerProgressLine {
  message: string;
  stream: DockerLogStream;
}

export type DockerProgressReporter = (line: DockerProgressLine) => void | Promise<void>;

export interface DockerBuildImageInput {
  appPath?: string | undefined;
  buildAptPackages?: string[] | undefined;
  buildCommand?: string | undefined;
  buildEnv?: Record<string, string> | undefined;
  contextDirectory: string;
  dockerfilePath?: string | undefined;
  imageTag: string;
  labels?: Record<string, string> | undefined;
  onProgressLine?: DockerProgressReporter | undefined;
  packer: DockerBuildPacker;
  pushRegistryCredentials?: DockerRegistryCredentials | undefined;
  pushImageInsecureRegistry?: boolean | undefined;
  pushImageTag?: string | undefined;
  runtimeAptPackages?: string[] | undefined;
  staticOutputDirectory?: string | undefined;
}

export interface DockerRegistryCredentials {
  password: string;
  serverAddress: string;
  username: string;
}

export interface DockerBuildImageResult {
  imageRef: string;
  pushed: boolean;
}

export interface DockerInspectImageInput {
  imageRef: string;
  registryCredentials?: DockerRegistryCredentials | undefined;
}

export interface DockerInspectImageResult {
  exposedPorts: number[];
  imageRef: string;
}

export interface DockerInspectContainerInput {
  containerRef: string;
}

export interface DockerInspectContainerResult {
  containerId: string;
  imageRef: string;
  isRunning: boolean;
  labels: Record<string, string>;
  networkAttachments?: DockerNetworkAttachment[] | undefined;
  publishedPorts: DockerPublishedPort[];
}

export interface DockerListContainersInput {
  all?: boolean | undefined;
  labelFilters?: Record<string, string | undefined> | undefined;
}

export interface DockerListContainerResult {
  containerId: string;
  isRunning: boolean;
  labels: Record<string, string>;
}

export interface DockerListNetworkResult {
  labels: Record<string, string>;
  name: string;
}

export interface DockerListVolumesInput {
  labelFilters?: Record<string, string | undefined> | undefined;
}

export interface DockerListVolumeResult {
  labels: Record<string, string>;
  name: string;
}

export interface DockerNetworkIpamConfig {
  gateway: string | null;
  subnet: string;
}

export type DockerNetworkMode = 'bridge' | 'host';

export interface DockerNamedNetwork {
  aliases?: string[] | undefined;
  name: string;
}

export type DockerNetworkTarget = DockerNetworkMode | DockerNamedNetwork;
export interface DockerNetworkAttachment {
  ipAddress: string | null;
  name: string;
}

export interface DockerEnsureNetworkInput {
  labels: Record<string, string>;
  networkName: string;
}

export interface DockerConnectContainerToNetworkInput {
  aliases?: string[] | undefined;
  containerRef: string;
  networkName: string;
}

export interface DockerDisconnectContainerFromNetworkInput {
  containerRef: string;
  networkName: string;
}

export interface DockerInspectNetworkInput {
  networkName: string;
}

export interface DockerInspectNetworkResult {
  endpointContainerIds: string[];
  ipamConfigs: DockerNetworkIpamConfig[];
  labels: Record<string, string>;
  name: string;
}

export interface DockerRemoveNetworkInput {
  networkName: string;
}

export interface DockerSyncNetworkEgressDenyRulesInput {
  destinationCidrs: string[];
  namespace: string;
  sourceAllowCidrs?: string[] | undefined;
  sourceSubnets: string[];
}

export type DockerRestartPolicyName = 'no' | 'on-failure' | 'unless-stopped';

export interface DockerRestartPolicy {
  maximumRetryCount?: number | undefined;
  name: DockerRestartPolicyName;
}

export interface DockerRunContainerInput {
  containerName: string;
  command?: string[] | undefined;
  env: Record<string, string>;
  extraHosts?: DockerExtraHost[] | undefined;
  imageRef: string;
  labels: Record<string, string>;
  mounts?: DockerBindMount[] | undefined;
  namedVolumes?: DockerNamedVolumeMount[] | undefined;
  network?: DockerNetworkTarget | undefined;
  publishedPorts?: DockerPublishedPort[] | undefined;
  restartPolicy?: DockerRestartPolicy | undefined;
  securityProfile: DockerContainerSecurityProfile;
  timeoutMs?: number | undefined;
}

export type DockerContainerSecurityProfile =
  | DockerRestrictedReadonlyContainerSecurityProfile
  | DockerRestrictedWritableContainerSecurityProfile
  | DockerPrivilegedWritableContainerSecurityProfile;

export type DockerContainerCapability = 'CHOWN' | 'DAC_OVERRIDE' | 'FOWNER' | 'NET_BIND_SERVICE' | 'SETGID' | 'SETUID';

export interface DockerContainerCapabilityAdditions {
  add: DockerContainerCapability[];
  reason: string;
}

export interface DockerRestrictedReadonlyContainerSecurityProfile {
  capabilityAdditions?: DockerContainerCapabilityAdditions | undefined;
  name: 'restricted-readonly';
  tmpfs?: string[] | undefined;
  user?: string | undefined;
}

export interface DockerRestrictedWritableContainerSecurityProfile {
  capabilityAdditions?: DockerContainerCapabilityAdditions | undefined;
  name: 'restricted-writable';
  user?: string | undefined;
  writableRootFilesystemReason: string;
}

export interface DockerPrivilegedWritableContainerSecurityProfile {
  name: 'privileged-writable';
  privilegedReason: string;
}

export interface DockerRunContainerResult {
  containerId: string;
}

export interface DockerRunContainerToCompletionResult {
  containerId: string;
  logs: DockerLogLine[];
  stderr: string;
  stdout: string;
}

export interface DockerPublishedPort {
  containerPort: number;
  hostIp?: string | undefined;
  hostPort: number;
}

export interface DockerBindMount {
  containerPath: string;
  hostPath: string;
  readOnly?: boolean | undefined;
}

export interface DockerNamedVolumeMount {
  labels?: Record<string, string> | undefined;
  name: string;
  targetPath: string;
}

export interface DockerExtraHost {
  host: string;
  target: string;
}

export interface DockerRemoveContainerInput {
  containerRef: string;
}

export interface DockerRenameContainerInput {
  containerRef: string;
  nextContainerName: string;
}

export interface DockerStartContainerInput {
  containerRef: string;
}

export interface DockerStopContainerInput {
  containerRef: string;
}

export interface DockerUpdateContainerRestartPolicyInput {
  containerRef: string;
  restartPolicy: DockerRestartPolicy;
}

export interface DockerRemoveVolumeInput {
  volumeName: string;
}

export interface DockerTailLogsInput {
  containerId: string;
  since?: string | undefined;
  tailLines?: number | undefined;
}

export interface DockerLogLine {
  message: string;
  stream: DockerLogStream;
  timestamp: string | null;
}

export interface DockerTailLogsResult {
  lines: DockerLogLine[];
}
