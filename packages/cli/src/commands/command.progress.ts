import type {
  CommandProgress,
  CommandProgressInput,
  CommandProgressState,
  CommandProgressTimer,
} from './command.progress.types';

const spinnerFrames: readonly string[] = ['-', '\\', '|', '/'];
const spinnerIntervalMs: number = 120;
const terminalClearLine: string = '\u001B[2K';
const terminalLineStart: string = '\r';

export function createCommandProgress(input: CommandProgressInput): CommandProgress {
  if (!shouldRenderCommandProgress(input)) {
    return new NoopCommandProgress();
  }

  if (input.io.stderrIsTTY !== true) {
    return new LineCommandProgress(input);
  }

  return new SpinnerCommandProgress(input);
}

class NoopCommandProgress implements CommandProgress {
  report(): void {
    return;
  }

  stop(): void {
    return;
  }
}

class LineCommandProgress implements CommandProgress {
  readonly #input: CommandProgressInput;

  constructor(input: CommandProgressInput) {
    this.#input = input;
  }

  report(message: string): void {
    this.#input.io.stderr(`${message}\n`);
  }

  stop(): void {
    return;
  }
}

class SpinnerCommandProgress implements CommandProgress {
  readonly #input: CommandProgressInput;
  readonly #state: CommandProgressState = {
    frameIndex: 0,
    message: null,
    rendered: false,
    timer: null,
  };

  constructor(input: CommandProgressInput) {
    this.#input = input;
  }

  report(message: string): void {
    if (hasLineBreak(message)) {
      renderCommandProgressLine(this.#input, this.#state, message);
      return;
    }

    this.#state.message = message;
    ensureCommandProgressTimer(this.#input, this.#state);
    renderCommandProgressFrame(this.#input, this.#state);
  }

  stop(): void {
    stopCommandProgressTimer(this.#state);
    clearRenderedCommandProgress(this.#input, this.#state);
    this.#state.message = null;
  }
}

function hasLineBreak(message: string): boolean {
  return message.includes('\n') || message.includes('\r');
}

function renderCommandProgressLine(input: CommandProgressInput, state: CommandProgressState, message: string): void {
  stopCommandProgressTimer(state);
  clearRenderedCommandProgress(input, state);
  state.message = null;
  input.io.stderr(readLineProgressMessage(message));
}

function stopCommandProgressTimer(state: CommandProgressState): void {
  if (state.timer === null) {
    return;
  }

  clearInterval(state.timer);
  state.timer = null;
}

function clearRenderedCommandProgress(input: CommandProgressInput, state: CommandProgressState): void {
  if (!state.rendered) {
    return;
  }

  input.io.stderr(`${terminalLineStart}${terminalClearLine}`);
  state.rendered = false;
}

function readLineProgressMessage(message: string): string {
  return message.endsWith('\n') ? message : `${message}\n`;
}

function ensureCommandProgressTimer(input: CommandProgressInput, state: CommandProgressState): void {
  if (state.timer !== null) {
    return;
  }

  state.timer = setInterval((): void => {
    renderCommandProgressFrame(input, state);
  }, spinnerIntervalMs);
  (state.timer as CommandProgressTimer).unref?.();
}

function renderCommandProgressFrame(input: CommandProgressInput, state: CommandProgressState): void {
  if (state.message === null) {
    return;
  }

  const frame: string = spinnerFrames[state.frameIndex % spinnerFrames.length]!;
  state.frameIndex += 1;
  state.rendered = true;
  input.io.stderr(`${terminalLineStart}${terminalClearLine}${frame} ${state.message}`);
}

function shouldRenderCommandProgress(input: CommandProgressInput): boolean {
  return input.enabled !== false && input.output === 'text';
}
