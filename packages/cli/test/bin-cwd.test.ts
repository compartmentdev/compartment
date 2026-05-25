import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBinExecutionCwd } from '../src/bin-cwd';

const originalCwd: string = process.cwd();

describe('bin cwd', (): void => {
  afterEach((): void => {
    process.chdir(originalCwd);
  });

  it('prefers INIT_CWD over PWD', async (): Promise<void> => {
    const executionCwd: string = await mkdtemp(join(tmpdir(), 'compartment-cli-bin-cwd-'));
    const pwdCwd: string = await mkdtemp(join(tmpdir(), 'compartment-cli-bin-pwd-'));

    try {
      process.chdir(originalCwd);
      applyBinExecutionCwd({
        INIT_CWD: executionCwd,
        PWD: pwdCwd,
      });

      expect(await realpath(process.cwd())).toBe(await realpath(executionCwd));
    } finally {
      process.chdir(originalCwd);
      await rm(executionCwd, { force: true, recursive: true });
      await rm(pwdCwd, { force: true, recursive: true });
    }
  });

  it('keeps the current cwd when neither override is present', (): void => {
    process.chdir(originalCwd);
    applyBinExecutionCwd({});

    expect(process.cwd()).toBe(originalCwd);
  });

  it('switches the process cwd to INIT_CWD before the CLI runs', async (): Promise<void> => {
    const executionCwd: string = await mkdtemp(join(tmpdir(), 'compartment-cli-bin-cwd-'));

    try {
      process.chdir(originalCwd);
      applyBinExecutionCwd({
        INIT_CWD: executionCwd,
      });

      expect(await realpath(process.cwd())).toBe(await realpath(executionCwd));
    } finally {
      process.chdir(originalCwd);
      await rm(executionCwd, { force: true, recursive: true });
    }
  });
});
