import type { Command } from 'commander';
import type { OrganizationUserResponse } from '@compartment/contracts';
import type { OutputFormat } from '../../output/output.types';
import { renderOutput } from '../../output/render';
import { unblockOrganizationUser } from '../../services/organization-users.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

interface UnblockUserCommandOptions {
  output: OutputFormat;
  remote?: string | undefined;
}

export function registerUnblockUserCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('unblock <email>').option('--output <format>', 'text or json', 'text')).action(
    async (email: string, options: UnblockUserCommandOptions): Promise<void> => {
      assertValidRemoteOption(options);
      const config: CliConfig = await readCliConfig();
      const response: OrganizationUserResponse = await unblockOrganizationUser(
        await createAuthenticatedContext(config, {
          cwd: process.cwd(),
          remoteName: options.remote,
        }),
        email,
      );

      renderOutput(dependencies.io, options.output, response, `Unblocked ${email} in the current organization.`);
    },
  );
}
