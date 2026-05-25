import { hasText } from '@compartment/utils';

export function applyBinExecutionCwd(env: NodeJS.ProcessEnv = process.env): void {
  const executionCwd: string = resolveBinExecutionCwd(env, process.cwd());
  if (executionCwd !== process.cwd()) {
    process.chdir(executionCwd);
  }
}

function resolveBinExecutionCwd(env: NodeJS.ProcessEnv, currentCwd: string): string {
  if (hasText(env.INIT_CWD)) {
    return env.INIT_CWD;
  }
  if (hasText(env.PWD)) {
    return env.PWD;
  }

  return currentCwd;
}
