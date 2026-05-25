import type { Command } from 'commander';
import type { RemoveUserResponse } from '@compartment/contracts';
import type { OutputFormat } from '../../output/output.types';
import { renderOutput } from '../../output/render';
import { removeOrganizationUser } from '../../services/organization-users.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, ConfirmedOutputOnlyOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

const missingUserRemoveConfirmationMessage: string = 'User remove requires --yes.';

interface RemoveUserCommandOptions extends ConfirmedOutputOnlyOptions {
  output: OutputFormat;
}

export function registerRemoveUserCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('remove <email>')
      .option('--output <format>', 'text or json', 'text')
      .option('--yes', 'confirm organization user removal'),
  ).action(async (email: string, options: RemoveUserCommandOptions): Promise<void> => {
    assertValidRemoteOption(options);
    if (options.yes !== true) {
      throw new Error(missingUserRemoveConfirmationMessage);
    }
    const config: CliConfig = await readCliConfig();
    const response: RemoveUserResponse = await removeOrganizationUser(
      await createAuthenticatedContext(config, {
        cwd: process.cwd(),
        remoteName: options.remote,
      }),
      email,
    );

    renderOutput(dependencies.io, options.output, response, `Removed ${email} from the current organization.`);
  });
}
