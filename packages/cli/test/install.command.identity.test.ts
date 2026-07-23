import { afterEach, describe, expect, it } from 'vitest';
import { resolveInstallIdentityPrompts } from '../src/commands/install/install.command.identity';
import type { ResolvedInstallIdentityPrompts } from '../src/commands/install/install.command.types';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

const adminPasswordEnvName: string = 'COMPARTMENT_ADMIN_PASSWORD';
const originalAdminPassword: string | undefined = process.env[adminPasswordEnvName];

afterEach((): void => {
  if (originalAdminPassword === undefined) {
    delete process.env[adminPasswordEnvName];
  } else {
    process.env[adminPasswordEnvName] = originalAdminPassword;
  }
});

describe.sequential('install identity input', (): void => {
  it('uses COMPARTMENT_ADMIN_PASSWORD without prompting', async (): Promise<void> => {
    process.env[adminPasswordEnvName] = 'correct horse battery staple';
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end();

    const prompts: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(
      { io: capture.io },
      {
        email: 'admin@example.com',
        organization: 'Acme Dev',
        output: 'text',
      },
    );

    expect(prompts.adminPassword).toBe('correct horse battery staple');
    expect(readCliStderr(capture)).not.toContain('Admin password');
  });

  it('rejects an invalid configured password without prompting', async (): Promise<void> => {
    process.env[adminPasswordEnvName] = 'short';
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end();

    await expect(
      resolveInstallIdentityPrompts(
        { io: capture.io },
        {
          email: 'admin@example.com',
          organization: 'Acme Dev',
          output: 'text',
        },
      ),
    ).rejects.toThrow('COMPARTMENT_ADMIN_PASSWORD: Password must be at least 8 characters.');
    expect(readCliStderr(capture)).not.toContain('Admin password');
  });
});
