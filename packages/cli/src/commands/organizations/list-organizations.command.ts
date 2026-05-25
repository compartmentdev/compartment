import type { Command } from 'commander';
import type { OrganizationListResponse, OrganizationSummary } from '@compartment/contracts';

import { renderOutput } from '../../output/render';
import { listOrganizations } from '../../services/organizations.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

export function registerListOrganizationsCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('list').option('--output <format>', 'text or json', 'text')).action(
    async (options: OutputOnlyOptions): Promise<void> => {
      assertValidRemoteOption(options);
      const config: CliConfig = await readCliConfig();
      const response: OrganizationListResponse = await listOrganizations(
        await createAuthenticatedContext(config, {
          cwd: process.cwd(),
          remoteName: options.remote,
        }),
      );
      const text: string = response.organizations
        .map((organization: OrganizationSummary): string => `${organization.slug}\t${organization.name}`)
        .join('\n');
      renderOutput(dependencies.io, options.output, response, text);
    },
  );
}
