import type { Command } from 'commander';
import { type WhoAmICommandResponse, type WhoAmIResponse, whoamiCommandResponseSchema } from '@compartment/contracts';

import { renderOutput } from '../../output/render';
import type { AuthenticatedContext } from '../../services/context.types';
import { runWhoAmI } from '../../services/whoami.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

export function registerWhoAmICommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('whoami').option('--output <format>', 'text or json', 'text')).action(
    async (options: OutputOnlyOptions): Promise<void> => {
      assertValidRemoteOption(options);
      const config: CliConfig = await readCliConfig();
      const context: AuthenticatedContext = await createAuthenticatedContext(config, {
        cwd: process.cwd(),
        remoteName: options.remote,
      });
      const response: WhoAmIResponse = await runWhoAmI(context);
      const commandResponse: WhoAmICommandResponse = whoamiCommandResponseSchema.parse({
        apiUrl: context.apiUrl,
        principal: response.principal,
        currentOrganization: response.currentOrganization,
        remoteName: context.remoteName,
      });

      renderOutput(dependencies.io, options.output, commandResponse, formatWhoAmIText(commandResponse));
    },
  );
}

function formatWhoAmIText(response: WhoAmICommandResponse): string {
  const currentOrganizationText: string =
    response.currentOrganization !== null ? ` in ${response.currentOrganization.slug}` : '';

  return `Authenticated as ${response.principal.email}${currentOrganizationText} against remote ${response.remoteName} at API ${response.apiUrl}`;
}
