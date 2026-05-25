import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { ExecuteFileAsync, PrepareRailpackPlanInput } from './railpack-command.types';
import {
  buildRailpackConfigEnv,
  railpackBuildAptPackagesEnvName,
  railpackDeployAptPackagesEnvName,
  railpackSpaOutputDirectoryEnvName,
  railpackStaticFileRootEnvName,
} from './railpack-env';

const executeFileAsync: ExecuteFileAsync = promisify(execFile);
const railpackCliBinaryName: string = 'railpack';

export async function prepareRailpackPlan(input: PrepareRailpackPlanInput): Promise<void> {
  const outputDirectory: string = readSharedOutputDirectory(input);
  await ensureRailpackOutputDirectories(outputDirectory);
  await runRailpackPrepareCommand(input);
}

function readSharedOutputDirectory(input: PrepareRailpackPlanInput): string {
  const planDirectory: string = dirname(input.planPath);
  const infoDirectory: string = dirname(input.infoPath);
  if (planDirectory !== infoDirectory) {
    throw new Error('Railpack plan and info outputs must share the same directory.');
  }

  return planDirectory;
}

async function ensureRailpackOutputDirectories(outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
}

async function runRailpackPrepareCommand(input: PrepareRailpackPlanInput): Promise<void> {
  try {
    await executeFileAsync(railpackCliBinaryName, buildRailpackPrepareCommand(input), {
      cwd: input.contextDirectory,
      env: buildRailpackProcessEnv(),
    });
  } catch (error) {
    throw createRailpackExecutionError(error instanceof Error ? error : null);
  }
}

function buildRailpackPrepareCommand(input: PrepareRailpackPlanInput): string[] {
  return [
    'prepare',
    input.appPath ?? '.',
    ...(input.buildCommand !== undefined ? ['--build-cmd', input.buildCommand] : []),
    ...buildRailpackEnvArgs(
      input.buildEnv,
      input.buildAptPackages,
      input.runtimeAptPackages,
      input.staticOutputDirectory,
    ),
    '--plan-out',
    input.planPath,
    '--info-out',
    input.infoPath,
  ];
}

function buildRailpackEnvArgs(
  buildEnv: Record<string, string> | undefined,
  buildAptPackages: string[] | undefined,
  runtimeAptPackages: string[] | undefined,
  staticOutputDirectory: string | undefined,
): string[] {
  return Object.entries(
    buildRailpackConfigEnv(buildEnv, buildAptPackages, runtimeAptPackages, staticOutputDirectory),
  ).flatMap(([name, value]: [string, string]): string[] => ['--env', `${name}=${value}`]);
}

function buildRailpackProcessEnv(): NodeJS.ProcessEnv {
  const railpackProcessEnv: NodeJS.ProcessEnv = { ...process.env };
  delete railpackProcessEnv[railpackBuildAptPackagesEnvName];
  delete railpackProcessEnv[railpackDeployAptPackagesEnvName];
  delete railpackProcessEnv[railpackSpaOutputDirectoryEnvName];
  delete railpackProcessEnv[railpackStaticFileRootEnvName];
  return railpackProcessEnv;
}

function createRailpackExecutionError(error: Error | null): Error {
  if (error && isMissingRailpackBinaryError(error)) {
    return new Error(
      'Railpack CLI is required on PATH. Install it with `curl -sSL https://railpack.com/install.sh | sh` before running source builds.',
    );
  }

  return error ?? new Error('Railpack command failed.');
}

function isMissingRailpackBinaryError(error: Error): error is NodeJS.ErrnoException {
  return 'code' in error && error.code === 'ENOENT';
}
