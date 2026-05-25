import type { Command } from 'commander';
import type { InviteUserResponse } from '@compartment/contracts';
import type { OutputFormat } from '../../output/output.types';
import { renderOutput } from '../../output/render';
import { inviteOrganizationUser } from '../../services/organization-users.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

interface InviteUserCommandOptions {
  output: OutputFormat;
  remote?: string | undefined;
}

export function registerInviteUserCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('invite <email>').option('--output <format>', 'text or json', 'text')).action(
    async (email: string, options: InviteUserCommandOptions): Promise<void> => {
      assertValidRemoteOption(options);
      const config: CliConfig = await readCliConfig();
      const response: InviteUserResponse = await inviteOrganizationUser(
        await createAuthenticatedContext(config, {
          cwd: process.cwd(),
          remoteName: options.remote,
        }),
        {
          email,
        },
      );

      renderOutput(dependencies.io, options.output, response, createInviteUserMessage(response));
    },
  );
}

function createInviteUserMessage(response: InviteUserResponse): string {
  if (response.invitation === null) {
    return `Invited ${response.user.email}. The user already has active credentials.`;
  }

  return `Invited ${response.user.email}.
Activation URL: ${response.invitation.activationUrl}
Invitation expires at: ${response.invitation.bootstrapExpiresAt}`;
}
