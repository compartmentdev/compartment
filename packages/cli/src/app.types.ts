export type CliOutputStreamName = 'stderr' | 'stdout';

export interface CliIo {
  stderrColumns?: number | undefined;
  stderrIsTTY?: boolean | undefined;
  stdin: NodeJS.ReadableStream;
  stderr: (value: string) => void;
  stdoutIsTTY?: boolean | undefined;
  stdout: (value: string) => void;
}

export interface CreateCliAppOptions {
  argv?: readonly string[] | undefined;
  io?: CliIo | undefined;
}
