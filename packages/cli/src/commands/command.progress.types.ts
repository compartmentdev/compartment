import type { CliIo } from '../app.types';
import type { OutputFormat } from '../output/output.types';

export interface CommandProgressInput {
  enabled?: boolean | undefined;
  io: CliIo;
  output: OutputFormat;
}

export interface CommandProgress {
  report(message: string): void;
  stop(): void;
}

export interface CommandProgressState {
  message: string | null;
  rendered: boolean;
}
