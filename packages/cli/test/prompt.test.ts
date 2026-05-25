import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { CliIo } from '../src/app.types';
import { promptInstallDocker } from '../src/prompts/install-docker.prompt';
import { readSecretPromptLine } from '../src/prompts/prompt-reader';
import {
  promptActivationToken,
  promptPort,
  promptRegisterEmail,
  promptRegisterOrganization,
  promptNewPassword,
  promptProjectName,
} from '../src/prompts/prompt';

interface PromptCapture {
  io: CliIo;
  stderr: string[];
  stdin: PassThrough;
}

type TtyPromptInput = PassThrough & {
  isTTY: true;
  setRawMode(mode: boolean): TtyPromptInput;
};

interface TtyPromptCapture extends PromptCapture {
  stdin: TtyPromptInput;
}

describe('prompt helpers', (): void => {
  it('re-prompts install email until a valid address is entered', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('\nadmin\nadmin@acme.dev\n');

    const email: string = await promptRegisterEmail(capture.io);

    expect(email).toBe('admin@acme.dev');
    expect(capture.stderr.join('')).toContain('Email is required for install.');
    expect(capture.stderr.join('')).toContain('Email must be a valid address.');
  });

  it('accepts the suggested organization name from email when input is empty', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('\n');

    const organizationName: string = await promptRegisterOrganization(capture.io, 'owner@acme-dev.com');

    expect(organizationName).toBe('Acme Dev');
    expect(capture.stderr.join('')).toContain('Organization name [Acme Dev]: ');
  });

  it('re-prompts password until it satisfies validation and confirmation', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('short\nsupersecretpassword\nmismatch\nsupersecretpassword\nsupersecretpassword\n');

    const password: string = await promptNewPassword(capture.io);

    expect(password).toBe('supersecretpassword');
    expect(capture.stderr.join('')).toContain('Password must be at least 8 characters.');
    expect(capture.stderr.join('')).toContain('Password confirmation does not match.');
    expect(capture.stderr.join('')).not.toContain('supersecretpassword');
  });

  it('does not echo secrets from raw-capable TTY streams', async (): Promise<void> => {
    const capture: TtyPromptCapture = createTtyPromptCapture();
    const passwordPrompt: Promise<string> = readSecretPromptLine(capture.io, 'Password: ');
    capture.stdin.end('supersecretpassword\n');

    const password: string = await passwordPrompt;

    expect(password).toBe('supersecretpassword');
    expect(capture.stderr.join('')).toContain('Password: ');
    expect(capture.stderr.join('')).not.toContain('supersecretpassword');
  });

  it('re-prompts activation token until a value is entered', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('\ninvite-token\n');

    const token: string = await promptActivationToken(capture.io);

    expect(token).toBe('invite-token');
    expect(capture.stderr.join('')).toContain('Invitation token is required.');
  });

  it('uses the default port on empty input and re-prompts invalid port values', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('broken\n70000\n\n');

    const port: number = await promptPort(capture.io, 'Public HTTP port', 80);

    expect(port).toBe(80);
    expect(capture.stderr.join('')).toContain('Public HTTP port must be an integer between 1 and 65535.');
    expect(capture.stderr.join('')).toContain('Public HTTP port [80]: ');
  });

  it('reads carriage-return line breaks from queued streams', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('\r');

    const port: number = await promptPort(capture.io, 'Public HTTP port', 80);

    expect(port).toBe(80);
  });

  it('preserves split CRLF line breaks in event-based streams', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    const firstToken: Promise<string> = promptActivationToken(capture.io);
    capture.stdin.write('first-token\r');
    capture.stdin.write('\nsecond-token\n');

    expect(await firstToken).toBe('first-token');
    expect(await promptActivationToken(capture.io)).toBe('second-token');
    expect(capture.stderr.join('')).not.toContain('Invitation token is required.');
  });

  it('accepts the suggested project name when input is empty', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('\n');

    const projectName: string = await promptProjectName(capture.io, 'backoffice-app');

    expect(projectName).toBe('backoffice-app');
    expect(capture.stderr.join('')).toContain('Project name [backoffice-app]: ');
  });

  it('re-prompts project name until a valid slug is entered', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('\n123\nbackoffice-app\n');

    const projectName: string = await promptProjectName(capture.io);

    expect(projectName).toBe('backoffice-app');
    expect(capture.stderr.join('')).toContain('Project name is required.');
    expect(capture.stderr.join('')).toContain(
      'Project name must be a slug starting with a letter, no longer than 63 characters, and not reserved by the browser console.',
    );
  });

  it('accepts yes for Docker installation after re-prompting invalid input', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('maybe\ny\n');

    const installDocker: boolean = await promptInstallDocker(capture.io);

    expect(installDocker).toBe(true);
    expect(capture.stderr.join('')).toContain('Enter `y` or `n`.');
    expect(capture.stderr.join('')).toContain(
      'Docker is not installed. Install Docker Engine and the Docker Compose plugin now? [Y/n]: ',
    );
  });

  it('defaults Docker installation to yes on empty input', async (): Promise<void> => {
    const capture: PromptCapture = createPromptCapture();
    capture.stdin.end('\n');

    const installDocker: boolean = await promptInstallDocker(capture.io);

    expect(installDocker).toBe(true);
  });
});

function createPromptCapture(): PromptCapture {
  const stdin: PassThrough = new PassThrough();
  const stderr: string[] = [];
  const io: CliIo = new PromptCaptureCliIo(stdin, stderr);

  return {
    io,
    stderr,
    stdin,
  };
}

function createTtyPromptCapture(): TtyPromptCapture {
  const capture: PromptCapture = createPromptCapture();
  const stdin: TtyPromptInput = capture.stdin as TtyPromptInput;
  stdin.isTTY = true;
  stdin.setRawMode = (): TtyPromptInput => stdin;

  return {
    ...capture,
    stdin,
  };
}

class PromptCaptureCliIo implements CliIo {
  readonly stdin: PassThrough;
  readonly #stderr: string[];

  constructor(stdin: PassThrough, stderr: string[]) {
    this.stdin = stdin;
    this.#stderr = stderr;
  }

  stderr(value: string): void {
    this.#stderr.push(value);
  }

  stdout(): void {
    return;
  }
}
