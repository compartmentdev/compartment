import { inspectDockerImage, type DockerInspectImageResult } from '@compartment/docker';

const defaultRuntimeContainerPort: number = 3000;

export async function resolveRuntimeContainerPort(
  imageRef: string,
  runtimeEnv: Record<string, string>,
): Promise<number> {
  const configuredPort: number | null = readRuntimeEnvContainerPort(runtimeEnv);
  const image: DockerInspectImageResult | null = await readRuntimeImage(imageRef, configuredPort);

  return readImageContainerPort(configuredPort, image);
}

export function resolveRuntimeImageContainerPort(
  runtimeEnv: Record<string, string>,
  image: DockerInspectImageResult,
): number {
  return readImageContainerPort(readRuntimeEnvContainerPort(runtimeEnv), image);
}

export function buildRuntimeEnv(runtimeEnv: Record<string, string>, containerPort: number): Record<string, string> {
  return runtimeEnv.PORT !== undefined
    ? runtimeEnv
    : {
        ...runtimeEnv,
        PORT: containerPort.toString(),
      };
}

async function readRuntimeImage(
  imageRef: string,
  configuredPort: number | null,
): Promise<DockerInspectImageResult | null> {
  if (configuredPort !== null) {
    return null;
  }

  return await inspectDockerImage({ imageRef });
}

function readImageContainerPort(configuredPort: number | null, image: DockerInspectImageResult | null): number {
  if (configuredPort !== null) {
    return configuredPort;
  }

  if (image === null) {
    throw new Error('Expected docker image metadata to resolve the runtime container port.');
  }

  return image.exposedPorts[0] ?? defaultRuntimeContainerPort;
}

function readRuntimeEnvContainerPort(runtimeEnv: Record<string, string>): number | null {
  const rawPort: string | undefined = runtimeEnv.PORT;
  if (rawPort === undefined) {
    return null;
  }

  const parsedPort: number = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    return null;
  }

  return parsedPort;
}
