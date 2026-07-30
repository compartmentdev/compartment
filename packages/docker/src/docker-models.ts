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
  cacheImageRef?: string | undefined;
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
