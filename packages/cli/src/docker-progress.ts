import type { DockerExecutionContext } from './docker-runtime.types';
import type { InstallProgressReportOptions } from './install.types';

export const inheritedCommandProgressReportOptions: InstallProgressReportOptions = { renderMode: 'line' };

export function readInheritedDockerProgressReportOptions(
  dockerContext: DockerExecutionContext,
): InstallProgressReportOptions | undefined {
  return dockerContext.mode === 'sudo' ? inheritedCommandProgressReportOptions : undefined;
}
