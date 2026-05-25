import { writeRailpackSecretFiles } from './docker-build-secrets';
import type { RailpackBuildSecrets, RailpackPlanPaths } from './docker-build.types';
import type { DockerBuildImageInput } from './docker-models';
import type { PrepareRailpackPlanInput } from './railpack-command.types';
import { buildRailpackConfigEnv } from './railpack-env';

export async function prepareRailpackBuildSecrets(
  railpackDirectory: string,
  input: DockerBuildImageInput,
): Promise<RailpackBuildSecrets> {
  const railpackConfigEnv: Record<string, string> = buildRailpackConfigEnv(
    input.buildEnv,
    input.buildAptPackages,
    input.runtimeAptPackages,
    input.staticOutputDirectory,
  );

  return {
    railpackConfigEnv,
    secretFiles: await writeRailpackSecretFiles(railpackDirectory, railpackConfigEnv),
  };
}

export function buildPrepareRailpackPlanInput(
  input: DockerBuildImageInput,
  railpackPlanPaths: RailpackPlanPaths,
): PrepareRailpackPlanInput {
  return {
    ...(input.appPath !== undefined ? { appPath: input.appPath } : {}),
    ...(input.buildAptPackages !== undefined ? { buildAptPackages: input.buildAptPackages } : {}),
    ...(input.buildCommand !== undefined ? { buildCommand: input.buildCommand } : {}),
    ...(input.buildEnv !== undefined ? { buildEnv: input.buildEnv } : {}),
    contextDirectory: input.contextDirectory,
    infoPath: railpackPlanPaths.infoPath,
    planPath: railpackPlanPaths.planPath,
    ...(input.runtimeAptPackages !== undefined ? { runtimeAptPackages: input.runtimeAptPackages } : {}),
    ...(input.staticOutputDirectory !== undefined ? { staticOutputDirectory: input.staticOutputDirectory } : {}),
  };
}

export function requireStaticOutputDirectory(input: DockerBuildImageInput): string {
  if (input.staticOutputDirectory !== undefined) {
    return input.staticOutputDirectory;
  }

  throw new Error('Static services must define staticOutputDirectory before image build.');
}
