import type { CliIo } from '../../app.types';
import type { OutputFormat } from '../../output/output.types';
import type { CliConfig } from '../../store/config.types';
import { resolveLoginRemote, type ResolvedLoginRemote } from './auth-remote.command';

interface ResolvedLoginIdentityPrompt {
  email?: string | undefined;
  remote: ResolvedLoginRemote;
}

export async function resolveLoginIdentityPrompt(
  io: CliIo,
  config: CliConfig,
  output: OutputFormat,
  explicitRemoteName: string | undefined,
  explicitApiUrl: string | undefined,
  explicitEmail: string | undefined,
): Promise<ResolvedLoginIdentityPrompt> {
  const remote: ResolvedLoginRemote = await resolveLoginRemote(io, config, output, explicitRemoteName, explicitApiUrl);

  return {
    email: explicitEmail,
    remote,
  };
}
