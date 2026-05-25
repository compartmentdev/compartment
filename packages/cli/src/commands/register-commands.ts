import type { Command } from 'commander';

import { registerAuditCommands } from './audit/audit.command';
import { registerActivateCommand } from './auth/activate.command';
import { registerAssignmentCommands } from './assignments/register-assignment.commands';
import { registerAuthCommands } from './auth/register-auth.commands';
import { registerDescriptorCommands } from './descriptor/register-descriptor.commands';
import { registerDomainCommands } from './domains/register-domain.commands';
import { registerGroupCommands } from './groups/register-group.commands';
import { registerInspectCommand } from './inspect/inspect.command';
import { registerInstallCommand } from './install/install.command';
import { registerInitCommand } from './init/init.command';
import { registerLoginCommand } from './auth/login.command';
import { registerDeployCommand } from './deploy/deploy.command';
import { registerDeploymentCommands } from './deployments/register-deployment.commands';
import { registerLogsCommand } from './logs/logs.command';
import { registerLogoutCommand } from './auth/logout.command';
import { registerPromoteCommand } from './promote.command';
import { registerRollbackCommand } from './rollback.command';
import { registerWhoAmICommand } from './identity/whoami.command';
import { registerOrganizationCommands } from './organizations/register-organization.commands';
import { registerProjectCommands } from './projects/register-project.commands';
import { registerRemoteCommands } from './remotes/register-remote.commands';
import { registerRoleCommands } from './roles/register-role.commands';
import { registerResourceCommands } from './resources/register-resource.commands';
import { registerStatusCommand } from './status/status.command';
import { registerSkillCommands } from './skills/register-skill.commands';
import { registerSsoCommands } from './sso/register-sso.commands';
import { registerSourceCommands } from './sources/register-source.commands';
import { registerSystemCommands } from './system/register-system.commands';
import { registerUserCommands } from './users/register-user.commands';
import { registerVariableCommands } from './variables/register-variable.commands';
import type { CliCommandDependencies } from './command.types';

export function registerCliCommands(program: Command, dependencies: CliCommandDependencies): void {
  registerAuthenticationCommands(program, dependencies);
  registerCoreProjectCommands(program, dependencies);
  registerProjectSupportCommands(program, dependencies);
  registerOrganizationContextCommands(program, dependencies);
}

function registerAuthenticationCommands(program: Command, dependencies: CliCommandDependencies): void {
  registerActivateCommand(program, dependencies);
  registerInstallCommand(program, dependencies);
  registerLoginCommand(program, dependencies);
  registerLogoutCommand(program, dependencies);
  registerWhoAmICommand(program, dependencies);
}

function registerCoreProjectCommands(program: Command, dependencies: CliCommandDependencies): void {
  registerDescriptorCommands(program, dependencies);
  registerDeploymentWorkflows(program, dependencies);
  registerProjectCommands(program, dependencies);
}

function registerDeploymentWorkflows(program: Command, dependencies: CliCommandDependencies): void {
  registerDeployCommand(program, dependencies);
  registerDeploymentCommands(program, dependencies);
  registerInspectCommand(program, dependencies);
  registerInitCommand(program, dependencies);
  registerLogsCommand(program, dependencies);
  registerPromoteCommand(program, dependencies);
  registerRollbackCommand(program, dependencies);
}

function registerProjectSupportCommands(program: Command, dependencies: CliCommandDependencies): void {
  registerResourceCommands(program, dependencies);
  registerSkillCommands(program, dependencies);
  registerStatusCommand(program, dependencies);
  registerSystemCommands(program, dependencies);
  registerVariableCommands(program, dependencies);
}

function registerOrganizationContextCommands(program: Command, dependencies: CliCommandDependencies): void {
  registerAssignmentCommands(program, dependencies);
  registerAuditCommands(program, dependencies);
  registerAuthCommands(program, dependencies);
  registerDomainCommands(program, dependencies);
  registerGroupCommands(program, dependencies);
  registerOrganizationCommands(program, dependencies);
  registerRemoteCommands(program, dependencies);
  registerRoleCommands(program, dependencies);
  registerSsoCommands(program, dependencies);
  registerSourceCommands(program, dependencies);
  registerUserCommands(program, dependencies);
}
