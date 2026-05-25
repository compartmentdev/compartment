export const railpackBuildAptPackagesEnvName: string = 'RAILPACK_BUILD_APT_PACKAGES';
export const railpackDeployAptPackagesEnvName: string = 'RAILPACK_DEPLOY_APT_PACKAGES';
export const railpackSpaOutputDirectoryEnvName: string = 'RAILPACK_SPA_OUTPUT_DIR';
export const railpackStaticFileRootEnvName: string = 'RAILPACK_STATIC_FILE_ROOT';

export function buildRailpackConfigEnv(
  buildEnv: Record<string, string> | undefined,
  buildAptPackages: string[] | undefined,
  runtimeAptPackages: string[] | undefined,
  staticOutputDirectory: string | undefined,
): Record<string, string> {
  const railpackConfigEnv: Record<string, string> = { ...(buildEnv ?? {}) };

  if (buildAptPackages !== undefined && buildAptPackages.length > 0) {
    railpackConfigEnv[railpackBuildAptPackagesEnvName] = buildAptPackages.join(' ');
  }

  if (runtimeAptPackages !== undefined && runtimeAptPackages.length > 0) {
    railpackConfigEnv[railpackDeployAptPackagesEnvName] = runtimeAptPackages.join(' ');
  }
  if (staticOutputDirectory !== undefined) {
    railpackConfigEnv[railpackSpaOutputDirectoryEnvName] = staticOutputDirectory;
    railpackConfigEnv[railpackStaticFileRootEnvName] = staticOutputDirectory;
  }

  return railpackConfigEnv;
}
