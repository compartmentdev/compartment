import type { CliIo, CliOutputStreamName } from '../app.types';

const terminalBoldStart: string = '\u001B[1m';
const terminalBoldEnd: string = '\u001B[22m';

export function shouldUseTerminalStyles(io: CliIo, output: CliOutputStreamName): boolean {
  return process.env.NO_COLOR === undefined && readOutputStreamIsTTY(io, output);
}

export function formatTerminalBold(value: string, enabled: boolean): string {
  return enabled ? `${terminalBoldStart}${value}${terminalBoldEnd}` : value;
}

function readOutputStreamIsTTY(io: CliIo, output: CliOutputStreamName): boolean {
  return output === 'stderr' ? io.stderrIsTTY === true : io.stdoutIsTTY === true;
}
