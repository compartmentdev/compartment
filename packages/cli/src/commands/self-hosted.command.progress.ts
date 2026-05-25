import type { CliIoCommandDependencies } from './command.types';

export function createSelfHostedProgressReporter(dependencies: CliIoCommandDependencies): (message: string) => void {
  return (message: string): void => {
    renderSelfHostedProgress(dependencies, message);
  };
}

function renderSelfHostedProgress(dependencies: CliIoCommandDependencies, message: string): void {
  dependencies.io.stderr(`${message}\n`);
}
