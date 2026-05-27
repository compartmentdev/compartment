import type { RuntimeShellCommandContainerInvocation } from './runtime-shell-command.types';

const defaultRuntimeShellCommandEntrypoint: readonly string[] = ['sh', '-lc'];
const shellEntrypointExecutableNames: ReadonlySet<string> = new Set(['ash', 'bash', 'dash', 'sh']);

export function buildRuntimeShellCommandContainerInvocation(
  command: string,
  imageEntrypoint?: readonly string[],
): RuntimeShellCommandContainerInvocation {
  return {
    command: [command],
    entrypoint: resolveRuntimeShellCommandEntrypoint(imageEntrypoint),
  };
}

function resolveRuntimeShellCommandEntrypoint(imageEntrypoint: readonly string[] | undefined): string[] {
  if (imageEntrypoint === undefined || !isShellCommandEntrypoint(imageEntrypoint)) {
    return [...defaultRuntimeShellCommandEntrypoint];
  }

  return [...imageEntrypoint];
}

function isShellCommandEntrypoint(entrypoint: readonly string[]): boolean {
  const executable: string | undefined = entrypoint[0];
  const commandFlag: string | undefined = entrypoint.at(-1);
  return (
    executable !== undefined &&
    commandFlag !== undefined &&
    shellEntrypointExecutableNames.has(readExecutableName(executable)) &&
    isShellCommandFlag(commandFlag)
  );
}

function readExecutableName(executable: string): string {
  return executable.split('/').at(-1) ?? executable;
}

function isShellCommandFlag(value: string): boolean {
  return value.startsWith('-') && !value.startsWith('--') && value.includes('c');
}
