import type { CliIo } from '../app.types';
import type { OutputFormat } from '../output/output.types';

export interface CommandProgressInput {
  enabled?: boolean | undefined;
  io: CliIo;
  output: OutputFormat;
}

export type CommandProgressMode = 'hidden' | 'line' | 'live';

export interface CommandProgress {
  readonly mode: CommandProgressMode;
  report(message: string): void;
  stop(): void;
}

export interface CommandProgressState {
  frameIndex: number;
  message: string | null;
  rendered: boolean;
  timer: NodeJS.Timeout | null;
}

export interface CommandProgressTimer {
  unref?: (() => void) | undefined;
}
