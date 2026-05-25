import type { DockerLogStream } from './docker-models';

export interface ProcessCommandInput {
  args: string[];
  env?: Record<string, string> | undefined;
  file: string;
}

export interface ProcessCommandResult {
  stderr: string;
  stdout: string;
}

export interface ProcessCommandOutputBuffers {
  stderr: string;
  stdout: string;
}

export interface ProcessCommandProgressHandlers {
  onLine: (stream: DockerLogStream, message: string) => void | Promise<void>;
}

export interface ProcessCommandError extends Error {
  code?: number | undefined;
  stderr?: string | undefined;
  stdout?: string | undefined;
}
