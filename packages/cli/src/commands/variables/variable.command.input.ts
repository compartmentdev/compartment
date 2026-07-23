import type { CliIo } from '../../app.types';
import { readPromptLine, readSecretPromptLine } from '../../prompts/prompt-reader';

interface ResolveVariableValueInput {
  io: CliIo;
  keyName: string;
  sensitive: boolean;
  stdin: boolean;
  value?: string | undefined;
}

export async function resolveVariableValue(input: ResolveVariableValueInput): Promise<string> {
  if (input.sensitive && input.value !== undefined) {
    throw new Error('Sensitive variables must use hidden prompt input or --stdin.');
  }
  if (input.stdin && input.value !== undefined) {
    throw new Error('Pass either a value or --stdin, not both.');
  }
  if (input.stdin) {
    return await readVariableValueFromStdin(input.io.stdin);
  }
  if (input.value !== undefined) {
    return input.value;
  }
  if (isTtyInput(input.io.stdin)) {
    return input.sensitive
      ? await promptSensitiveVariableValue(input.io, input.keyName)
      : await promptPlainVariableValue(input.io, input.keyName);
  }

  throw new Error(buildMissingVariableValueMessage(input.keyName, input.sensitive));
}

async function promptPlainVariableValue(io: CliIo, keyName: string): Promise<string> {
  return await readPromptLine(io, `Value for ${keyName}: `);
}

async function promptSensitiveVariableValue(io: CliIo, keyName: string): Promise<string> {
  const value: string = await readSecretPromptLine(io, `Value for ${keyName}: `);
  io.stderr('\n');
  return value;
}

async function readVariableValueFromStdin(input: NodeJS.ReadableStream): Promise<string> {
  let value: string = '';

  for await (const chunk of input) {
    value += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  }

  return stripSingleTrailingLineBreak(value);
}

function isTtyInput(input: NodeJS.ReadableStream): boolean {
  return (input as { isTTY?: boolean | undefined }).isTTY === true;
}

function stripSingleTrailingLineBreak(value: string): string {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2);
  }
  if (value.endsWith('\n') || value.endsWith('\r')) {
    return value.slice(0, -1);
  }

  return value;
}

function buildMissingVariableValueMessage(keyName: string, sensitive: boolean): string {
  return sensitive
    ? `Missing value for ${keyName}. Use --stdin or run from a TTY to enter it securely.`
    : `Missing value for ${keyName}. Use "variable set ${keyName} VALUE" or "variable set ${keyName}=VALUE", pass --stdin, or run from a TTY to be prompted.`;
}
