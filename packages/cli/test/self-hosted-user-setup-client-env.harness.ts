import { join } from 'node:path';

export function buildSelfHostedUserSetupClientEnv(homeDirectory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.COMPARTMENT_CLI_CONFIG_DIR;
  env.HOME = homeDirectory;
  env.XDG_CONFIG_HOME = join(homeDirectory, '.config');
  return env;
}
