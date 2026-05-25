import { isSea } from 'node:sea';
import { Command } from 'commander';

import type { CliIo, CreateCliAppOptions } from './app.types';
import { readCliVersion } from './cli-build-info';
import { registerCliCommands } from './commands/register-commands';

export function createCliProgram({ argv = [], io = defaultIo }: CreateCliAppOptions = {}): Command {
  const program: Command = new Command();
  program
    .name('compartment')
    .description('Phase 0 compartment CLI')
    .enablePositionalOptions()
    .version(readCliVersion())
    .exitOverride()
    .configureOutput({
      writeErr: io.stderr,
      writeOut: io.stdout,
    });
  registerCliCommands(program, {
    argv,
    commandPrefix: readCliProcessCommandPrefix(argv),
    io,
  });
  return program;
}

class ProcessCliIo implements CliIo {
  readonly stderrIsTTY: boolean | undefined = process.stderr.isTTY;
  readonly stdin: NodeJS.ReadableStream = process.stdin;
  readonly stdoutIsTTY: boolean | undefined = process.stdout.isTTY;

  stderr(value: string): void {
    process.stderr.write(value);
  }

  stdout(value: string): void {
    process.stdout.write(value);
  }
}

const defaultIo: CliIo = new ProcessCliIo();
export const defaultCliIo: CliIo = defaultIo;

function readCliProcessCommandPrefix(argv: readonly string[]): readonly string[] {
  if (isSea()) {
    return [process.execPath];
  }

  const prefixLength: number = Math.max(1, process.argv.length - argv.length);
  return process.argv.slice(0, prefixLength);
}
