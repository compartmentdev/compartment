import { ensureDockerExecutionContext } from './docker-runtime';
import type { DockerExecutionContext } from './docker-runtime.types';
import type { InstallContext } from './install.types';

export async function ensureSelfHostedDockerExecutionContext(
  context: InstallContext | undefined,
): Promise<DockerExecutionContext> {
  return await ensureDockerExecutionContext({
    allowInteractiveSudo: context?.allowInteractiveSudo ?? isInteractiveSelfHostedSession(),
    confirmInstallWhenMissing: context?.confirmInstallWhenMissing,
    installWhenMissing: true,
    reportProgress: context?.reportProgress,
  });
}

function isInteractiveSelfHostedSession(): boolean {
  return process.stdin.isTTY === true;
}
