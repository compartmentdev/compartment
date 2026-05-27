import type { RuntimeShellCommandContainerInvocation } from './runtime-shell-command.types';

const runtimeShellCommandEntrypoint: readonly string[] = ['sh', '-lc'];

export function buildRuntimeShellCommandContainerInvocation(command: string): RuntimeShellCommandContainerInvocation {
  return {
    command: [command],
    entrypoint: [...runtimeShellCommandEntrypoint],
  };
}
