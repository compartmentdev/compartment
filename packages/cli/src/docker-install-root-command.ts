import { canRunCommand, runInheritedCommand } from './command-runner';
import type { CommandResult } from './command-runner.types';
import type { InstallProgressReporter } from './install.types';

export type RootCommandMode = 'direct' | 'sudo' | 'sudo-n';

export interface RootCommandSpec {
  commandPrefix: readonly string[];
  mode: RootCommandMode;
}

export async function readRootCommandSpec(): Promise<RootCommandSpec> {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return { commandPrefix: [], mode: 'direct' };
  }

  if (await canRunCommand(['sudo', '-n', 'true'])) {
    return { commandPrefix: ['sudo', '-n'], mode: 'sudo-n' };
  }

  if (process.stdin.isTTY === true) {
    const validateSudoResult: CommandResult = await runInheritedCommand(['sudo', '-v']);
    if (validateSudoResult.exitCode === 0) {
      return { commandPrefix: ['sudo'], mode: 'sudo' };
    }
  }

  throw new Error(
    'Automatic Docker installation requires root or sudo access on supported Linux hosts. Install Docker manually or re-run `compartment install` in an interactive shell with sudo access.',
  );
}

export function reportRootCommandInstallProgress(
  rootCommandSpec: RootCommandSpec,
  reportProgress?: InstallProgressReporter,
): void {
  if (rootCommandSpec.mode === 'sudo') {
    reportProgress?.('Automatic Docker installation requires sudo; you may be prompted for your password.');
    return;
  }

  if (rootCommandSpec.mode === 'sudo-n') {
    reportProgress?.('Automatic Docker installation is using cached sudo access.');
  }
}
