import { setTimeout as sleep } from 'node:timers/promises';
import type { CliLoginStartResponse, CliLoginStatusResponse, LoginResponse } from '@compartment/contracts';
import type { CliCommandDependencies } from '../command.types';
import { exchangeCliLogin, getCliLoginStatus, startCliLogin } from '../../services/cli-login.service';
import type { ApiContext } from '../../services/context.types';
import { formatTerminalBold, shouldUseTerminalStyles } from '../terminal-style.helpers';

export async function performLoginCommandFlow(
  dependencies: CliCommandDependencies,
  context: ApiContext,
  email?: string,
  onboardingSessionId?: string,
  organizationSlug?: string,
): Promise<LoginResponse> {
  return await loginWithCliBrowser(dependencies, context, email, onboardingSessionId, organizationSlug);
}

async function loginWithCliBrowser(
  dependencies: CliCommandDependencies,
  context: ApiContext,
  email: string | undefined,
  onboardingSessionId: string | undefined,
  organizationSlug: string | undefined,
): Promise<LoginResponse> {
  const started: CliLoginStartResponse = await startCliLogin(context, {
    ...(email !== undefined ? { email } : {}),
    ...(onboardingSessionId !== undefined ? { onboardingSessionId } : {}),
    ...(organizationSlug !== undefined ? { organizationSlug } : {}),
  });

  writeCliLoginInstructions(dependencies, started.verificationUrl);
  await waitForCliLoginAuthentication(dependencies, context, started);

  return await exchangeCliLogin(context, {
    attemptId: started.attemptId,
    exchangeSecret: started.exchangeSecret,
  });
}

function writeCliLoginInstructions(dependencies: CliCommandDependencies, verificationUrl: string): void {
  const heading: string = formatTerminalBold(
    'Open this URL in a browser to continue login:',
    shouldUseTerminalStyles(dependencies.io, 'stderr'),
  );
  dependencies.io.stderr(`${heading}\n${verificationUrl}\n`);
}

async function waitForCliLoginAuthentication(
  dependencies: CliCommandDependencies,
  context: ApiContext,
  started: CliLoginStartResponse,
): Promise<void> {
  for (;;) {
    const status: CliLoginStatusResponse = await getCliLoginStatus(context, {
      attemptId: started.attemptId,
      exchangeSecret: started.exchangeSecret,
    });
    if (await shouldContinueCliLoginPolling(dependencies, started, status)) {
      continue;
    }

    return;
  }
}

async function shouldContinueCliLoginPolling(
  dependencies: CliCommandDependencies,
  started: CliLoginStartResponse,
  status: CliLoginStatusResponse,
): Promise<boolean> {
  switch (status.status) {
    case 'pending':
      await sleep(started.pollAfterMs);
      return true;
    case 'authenticated':
      dependencies.io.stderr('Browser authentication completed. Finishing login...\n');
      return false;
    case 'expired':
      throw new Error('CLI login expired before it was completed. Run `compartment login` again.');
    case 'exchanged':
      throw new Error('CLI login was already exchanged. Run `compartment login` again.');
  }
}
