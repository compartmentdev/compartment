import type { ExecFileOptions } from 'node:child_process';

export interface PrepareRailpackPlanInput {
  appPath?: string | undefined;
  buildAptPackages?: string[] | undefined;
  buildCommand?: string | undefined;
  buildEnv?: Record<string, string> | undefined;
  contextDirectory: string;
  infoPath: string;
  planPath: string;
  runtimeAptPackages?: string[] | undefined;
  staticOutputDirectory?: string | undefined;
}

export type ExecuteFileAsync = (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }>;
