import { CommanderError, type Command } from 'commander';

import type { CliIo } from './app.types';
import { createCliProgram, defaultCliIo } from './create-cli-program';

export async function runCli(argv: string[], io: CliIo = defaultCliIo): Promise<number> {
  const program: Command = createCliProgram({
    argv,
    io,
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    const message: string = error instanceof Error ? error.message : 'Unknown CLI error';
    io.stderr(`${message}\n`);
    return 1;
  }
}
