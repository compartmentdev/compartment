import type { CompartmentServiceKind } from './compartment-service-kind.contract';
import { isStaticCompartmentServiceKind, resolveStaticCompartmentServiceBuildPacker } from './service-static.contract';
import type {
  ResolvedCompartmentServiceBuildConfig,
  ResolvedCompartmentServiceBuildPackagesConfig,
} from './service-build.contract';

export type ResolvedCompartmentServiceBuildPacker = 'dockerfile' | 'railpack' | 'static';

export interface ResolvedCompartmentServiceBuildExecution {
  buildAptPackages: string[];
  buildCommand?: string | undefined;
  outputDirectory?: string | undefined;
  packer: ResolvedCompartmentServiceBuildPacker;
  runtimeAptPackages: string[];
}

interface ResolvedCompartmentServiceBuildExecutionPackages {
  buildAptPackages: string[];
  runtimeAptPackages: string[];
}

export function resolveCompartmentServiceBuildExecution(
  build: ResolvedCompartmentServiceBuildConfig,
  dockerfilePresent: boolean,
  servicePath: string,
  kind: CompartmentServiceKind,
): ResolvedCompartmentServiceBuildExecution {
  const packer: ResolvedCompartmentServiceBuildPacker = resolveCompartmentServiceBuildPacker(
    build,
    dockerfilePresent,
    servicePath,
    kind,
  );
  return {
    ...resolveBuildExecutionPackages(servicePath, build.packages, packer),
    ...(build.command !== undefined
      ? { buildCommand: requireSourceBuildCommand(servicePath, build.command, packer) }
      : {}),
    ...(build.outputDirectory !== undefined ? { outputDirectory: build.outputDirectory } : {}),
    packer,
  };
}

function resolveCompartmentServiceBuildPacker(
  build: ResolvedCompartmentServiceBuildConfig,
  dockerfilePresent: boolean,
  servicePath: string,
  kind: CompartmentServiceKind,
): ResolvedCompartmentServiceBuildPacker {
  if (isStaticCompartmentServiceKind(kind)) {
    return resolveStaticCompartmentServiceBuildPacker(build.strategy, servicePath);
  }
  if (build.strategy === 'dockerfile') {
    if (!dockerfilePresent) {
      throw new Error(`Build strategy "dockerfile" requires a Dockerfile in service directory "${servicePath}".`);
    }

    return 'dockerfile';
  }
  if (build.strategy === 'railpack') {
    return 'railpack';
  }

  return dockerfilePresent ? 'dockerfile' : 'railpack';
}

function requireSourceBuildCommand(
  servicePath: string,
  buildCommand: string,
  packer: ResolvedCompartmentServiceBuildPacker,
): string {
  if (packer === 'railpack' || packer === 'static') {
    return buildCommand;
  }

  throw new Error(
    `Build command is only supported for source-built services. Service "${servicePath}" resolved to Dockerfile build.`,
  );
}

function resolveBuildExecutionPackages(
  servicePath: string,
  packages: ResolvedCompartmentServiceBuildPackagesConfig,
  packer: ResolvedCompartmentServiceBuildPacker,
): ResolvedCompartmentServiceBuildExecutionPackages {
  return {
    buildAptPackages: requireSourceBuildPackages(servicePath, packages.build, packer),
    runtimeAptPackages: requireSourceBuildPackages(servicePath, packages.runtime, packer),
  };
}

function requireSourceBuildPackages(
  servicePath: string,
  buildPackages: readonly string[],
  packer: ResolvedCompartmentServiceBuildPacker,
): string[] {
  if (buildPackages.length === 0 || packer === 'railpack' || packer === 'static') {
    return [...buildPackages];
  }

  throw new Error(
    `Build packages are only supported for source-built services. Service "${servicePath}" resolved to Dockerfile build.`,
  );
}
