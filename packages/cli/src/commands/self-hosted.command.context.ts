import type { InstallContext, InstallProgressReporter } from '../install.types';
import { promptInstallDocker } from '../prompts/install-docker.prompt';
import type { CliIoCommandDependencies } from './command.types';

interface PromptReadableStream extends NodeJS.ReadableStream {
  isTTY?: boolean | undefined;
}

export function createSelfHostedCommandContext(
  dependencies: CliIoCommandDependencies,
  reportProgress: InstallProgressReporter,
): InstallContext {
  return new SelfHostedCommandContext(readSelfHostedCommandIsInteractive(dependencies), reportProgress, dependencies);
}

function readSelfHostedCommandIsInteractive(dependencies: CliIoCommandDependencies): boolean {
  return (dependencies.io.stdin as PromptReadableStream).isTTY === true;
}

class SelfHostedCommandContext implements InstallContext {
  readonly allowInteractiveSudo: boolean;
  readonly confirmInstallWhenMissing?: (() => Promise<boolean>) | undefined;
  readonly reportProgress: InstallProgressReporter;

  constructor(
    allowInteractiveSudo: boolean,
    reportProgress: InstallProgressReporter,
    dependencies: CliIoCommandDependencies,
  ) {
    this.allowInteractiveSudo = allowInteractiveSudo;
    this.confirmInstallWhenMissing = allowInteractiveSudo
      ? async (): Promise<boolean> => await promptInstallDocker(dependencies.io)
      : undefined;
    this.reportProgress = reportProgress;
  }
}
