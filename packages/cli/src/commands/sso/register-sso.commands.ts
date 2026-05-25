import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerSsoOidcCommands } from './sso-oidc.command';

export function registerSsoCommands(program: Command, dependencies: CliCommandDependencies): void {
  const ssoCommand: Command = program.command('sso').description('Organization SSO configuration');
  registerSsoOidcCommands(ssoCommand, dependencies);
}
