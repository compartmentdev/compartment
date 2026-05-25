import { setTimeout as sleep } from 'node:timers/promises';
import {
  formatCommandOutput,
  type SelfHostedUserSetupCommandResult,
  type SelfHostedUserSetupRunningCommand,
} from './self-hosted-user-setup-command.harness';

const defaultCliVerificationUrlTimeoutMs: number = 30_000;

export async function waitForCliVerificationUrl(
  loginCommand: SelfHostedUserSetupRunningCommand,
  timeoutMs: number = defaultCliVerificationUrlTimeoutMs,
): Promise<string> {
  const deadlineAt: number = Date.now() + timeoutMs;

  for (;;) {
    const pendingResult: Promise<SelfHostedUserSetupCommandResult | null> = loginCommand.result.then(
      (result: SelfHostedUserSetupCommandResult): SelfHostedUserSetupCommandResult => result,
      (): null => null,
    );
    const settledResult: SelfHostedUserSetupCommandResult | null = await Promise.race([pendingResult, sleep(50, null)]);
    if (settledResult !== null) {
      throw new Error(`Login exited before printing verification URL.\n${formatCommandOutput(settledResult.stderr)}`);
    }

    const stderrOutput: string = loginCommand.readStderr();
    const match: RegExpExecArray | null = /https?:\/\/\S+/u.exec(stderrOutput);
    if (match?.[0] !== undefined) {
      return match[0];
    }
    if (Date.now() >= deadlineAt) {
      throw new Error(`Timed out waiting for a CLI verification URL.\n${formatCommandOutput(stderrOutput)}`);
    }
  }
}
