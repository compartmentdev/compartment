import type { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/app';
import {
  promptActivationToken,
  promptNewPassword,
  promptRequiredVisibleText,
  promptValidatedVisibleText,
} from '../src/prompts/prompt';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

const adminPasswordEnvName: string = 'COMPARTMENT_ADMIN_PASSWORD';
const originalAdminPassword: string | undefined = process.env[adminPasswordEnvName];

interface InteractivePromptInput {
  setRawMode: (mode: boolean) => void;
}

type InteractivePromptTestInput = PassThrough & InteractivePromptInput;

afterEach((): void => {
  if (originalAdminPassword === undefined) {
    delete process.env[adminPasswordEnvName];
  } else {
    process.env[adminPasswordEnvName] = originalAdminPassword;
  }
});

describe.sequential('prompt input safety', (): void => {
  it('fails once when install reaches an admin password prompt with closed stdin', async (): Promise<void> => {
    delete process.env[adminPasswordEnvName];
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end();

    const exitCode: number = await runCli(
      ['install', '--dev', '--email', 'admin@example.com', '--organization', 'Acme Dev'],
      capture.io,
    );
    const stderr: string = readCliStderr(capture);

    expect(exitCode).toBe(1);
    expect(countOccurrences(stderr, 'Interactive terminal required for prompt input.')).toBe(1);
    expect(countOccurrences(stderr, 'Admin password: ')).toBe(1);
  });

  it('rejects a required visible prompt when stdin is closed', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end();

    await expect(promptActivationToken(capture.io)).rejects.toThrow('Interactive terminal required for prompt input.');
    expect(countOccurrences(readCliStderr(capture), 'Invitation token: ')).toBe(1);
  });

  it('accepts a matching password and confirmation', async (): Promise<void> => {
    const capture: CliCommandCapture = createInteractiveCliCapture();
    const resolution: Promise<string> = promptNewPassword(capture.io);

    await answerInteractivePrompt(capture, 'Admin password: ', 'supersecretpassword');
    await answerInteractivePrompt(capture, 'Confirm password: ', 'supersecretpassword');
    await expect(resolution).resolves.toBe('supersecretpassword');
    expect(readCliStderr(capture)).toContain('Confirm password: ');
    capture.stdin.end();
  });

  it('re-prompts an empty required wizard field without ending the process', async (): Promise<void> => {
    const capture: CliCommandCapture = createInteractiveCliCapture();
    const resolution: Promise<string> = promptRequiredVisibleText(capture.io, 'Private registry TLS issuer name');

    await answerInteractivePrompt(capture, 'Private registry TLS issuer name: ', '');
    await answerInteractivePrompt(capture, 'Private registry TLS issuer name: ', 'compartment-registry-ca', 2);

    await expect(resolution).resolves.toBe('compartment-registry-ca');
    expect(readCliStderr(capture)).toContain('Private registry TLS issuer name is required.');
    capture.stdin.end();
  });

  it('re-prompts an invalid required wizard field without ending the process', async (): Promise<void> => {
    const capture: CliCommandCapture = createInteractiveCliCapture();
    const resolution: Promise<string> = promptValidatedVisibleText(
      capture.io,
      'Private registry TLS issuer name',
      (value: string): string | undefined => (value.includes('_') ? 'Issuer name is invalid.' : undefined),
    );

    await answerInteractivePrompt(capture, 'Private registry TLS issuer name: ', 'invalid_name');
    await answerInteractivePrompt(capture, 'Private registry TLS issuer name: ', 'compartment-registry-ca', 2);

    await expect(resolution).resolves.toBe('compartment-registry-ca');
    expect(readCliStderr(capture)).toContain('Issuer name is invalid.');
    capture.stdin.end();
  });

  it('stops after three invalid password attempts', async (): Promise<void> => {
    const capture: CliCommandCapture = createInteractiveCliCapture();
    const resolution: Promise<string> = promptNewPassword(capture.io);

    await answerInteractivePrompt(capture, 'Admin password: ', 'short', 1);
    await answerInteractivePrompt(capture, 'Admin password: ', 'invalid', 2);
    await answerInteractivePrompt(capture, 'Admin password: ', 'bad', 3);
    await expect(resolution).rejects.toThrow('Password entry failed after 3 attempts.');
    expect(countOccurrences(readCliStderr(capture), 'Password must be at least 8 characters.')).toBe(3);
    capture.stdin.end();
  });
});

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function createInteractiveCliCapture(): CliCommandCapture {
  const capture: CliCommandCapture = createCliCapture({ isTTY: true });
  const input: InteractivePromptTestInput = capture.stdin as InteractivePromptTestInput;
  input.setRawMode = (): void => undefined;
  return capture;
}

async function answerInteractivePrompt(
  capture: CliCommandCapture,
  label: string,
  answer: string,
  occurrence: number = 1,
): Promise<void> {
  while (countOccurrences(readCliStderr(capture), label) < occurrence) {
    await new Promise<void>((resolve: () => void): void => {
      setImmediate(resolve);
    });
  }
  capture.stdin.write(`${answer}\n`);
}
