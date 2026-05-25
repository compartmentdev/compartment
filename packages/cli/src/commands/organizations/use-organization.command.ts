import type { Command } from 'commander';

import { renderOutput } from '../../output/render';
import { useOrganization } from '../../services/organizations.service';
import type { AuthenticatedContext } from '../../services/context.types';
import { buildOrganizationSelectionConfig } from '../../store/config.mutations';
import { readCliConfig, writeCliConfig } from '../../store/config.store';
import type { CliConfig, CliOrganizationConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

export function registerUseOrganizationCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('use <slug>').option('--output <format>', 'text or json', 'text')).action(
    async (organizationSlug: string, options: OutputOnlyOptions): Promise<void> => {
      assertValidRemoteOption(options);
      const config: CliConfig = await readCliConfig();
      const context: AuthenticatedContext = await createAuthenticatedContext(config, {
        cwd: process.cwd(),
        remoteName: options.remote,
      });
      const selectedOrganization: CliOrganizationConfig = await useOrganization(context, organizationSlug);
      await writeCliConfig(buildOrganizationSelectionConfig(config, context.remoteName, selectedOrganization));
      renderOutput(
        dependencies.io,
        options.output,
        { organization: selectedOrganization },
        `Using organization ${selectedOrganization.slug}`,
      );
    },
  );
}
