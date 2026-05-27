import type { CommandProgress, CommandProgressInput, CommandProgressState } from './command.progress.types';

const terminalClearLine: string = '\u001B[2K';
const terminalLineStart: string = '\r';

export function createCommandProgress(input: CommandProgressInput): CommandProgress {
  if (!shouldRenderCommandProgress(input)) {
    return new NoopCommandProgress();
  }

  if (input.io.stderrIsTTY !== true) {
    return new LineCommandProgress(input);
  }

  return new StatusLineCommandProgress(input);
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

class StatusLineCommandProgress implements CommandProgress {
  readonly #input: CommandProgressInput;
  readonly #state: CommandProgressState = {
    message: null,
    rendered: false,
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
    renderCommandProgressStatusLine(this.#input, this.#state);
  }

  stop(): void {
    clearRenderedCommandProgress(this.#input, this.#state);
    this.#state.message = null;
  }
}

function hasLineBreak(message: string): boolean {
  return message.includes('\n') || message.includes('\r');
}

function renderCommandProgressLine(input: CommandProgressInput, state: CommandProgressState, message: string): void {
  clearRenderedCommandProgress(input, state);
  state.message = null;
  input.io.stderr(readLineProgressMessage(message));
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

function renderCommandProgressStatusLine(input: CommandProgressInput, state: CommandProgressState): void {
  if (state.message === null) {
    return;
  }

  state.rendered = true;
  input.io.stderr(`${terminalLineStart}${terminalClearLine}${state.message}`);
}

function shouldRenderCommandProgress(input: CommandProgressInput): boolean {
  return input.enabled !== false && input.output === 'text';
}
