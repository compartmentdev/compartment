import type { CliIo } from '../app.types';
import type { OutputFormat } from '../output/output.types';

export interface CliIoCommandDependencies {
  io: CliIo;
}

export interface CliCommandDependencies extends CliIoCommandDependencies {
  argv: readonly string[];
  commandPrefix: readonly string[];
}

export interface InitCommandOptions {
  name?: string | undefined;
  output: OutputFormat;
}

export interface SkillInstallCommandOptions {
  agent?: string | undefined;
  interactive?: boolean | undefined;
  output: OutputFormat;
}

export interface LoginCommandOptions {
  apiUrl?: string | undefined;
  email?: string | undefined;
  onboardingSession?: string | undefined;
  organization?: string | undefined;
  output: OutputFormat;
  remote?: string | undefined;
}

export interface ActivateCommandOptions {
  apiUrl?: string | undefined;
  email?: string | undefined;
  output: OutputFormat;
  remote?: string | undefined;
  token?: string | undefined;
}

export interface OutputOnlyOptions {
  output: OutputFormat;
  remote?: string | undefined;
}

export interface ConfirmedOutputOnlyOptions extends OutputOnlyOptions {
  yes?: boolean | undefined;
}

export interface ListCommandOptions extends OutputOnlyOptions {
  page?: string | undefined;
  perPage?: string | undefined;
}

export interface CreateOrganizationCommandOptions extends OutputOnlyOptions {
  name?: string | undefined;
  slug?: string | undefined;
}

export interface ProjectCommandOptions extends OutputOnlyOptions {
  project?: string | undefined;
}

export interface ArchiveProjectCommandOptions extends ProjectCommandOptions {
  yes?: boolean | undefined;
}

export interface ProjectLifecycleCommandOptions extends ProjectCommandOptions {
  env?: string | undefined;
}

export interface DeleteProjectCommandOptions extends ProjectCommandOptions {
  yes?: boolean | undefined;
}

export interface VariableCommandOptions extends ProjectCommandOptions {
  env?: string | undefined;
  resource?: string | undefined;
  service?: string | undefined;
}

export interface RunVariableCommandOptions extends VariableCommandOptions {
  allowProduction?: boolean | undefined;
}

export type CustomDomainCommandOptions = VariableCommandOptions;

export interface SetVariableCommandOptions extends VariableCommandOptions {
  fromResource?: string | undefined;
  sensitive?: boolean | undefined;
  stdin?: boolean | undefined;
}

export type VariableGroupCommandOptions = OutputOnlyOptions;

export interface VariableGroupCaptureCommandOptions extends VariableCommandOptions {
  effective?: boolean | undefined;
}

export interface VariableGroupPutCommandOptions extends OutputOnlyOptions {
  sensitive?: boolean | undefined;
  stdin?: boolean | undefined;
}

export interface VariableGroupImportCommandOptions extends OutputOnlyOptions {
  file: string;
  replace?: boolean | undefined;
  sensitive?: boolean | undefined;
}

export interface ImportVariableCommandOptions extends VariableCommandOptions {
  file: string;
  replace?: boolean | undefined;
  sensitive?: boolean | undefined;
}

export interface ProjectListCommandOptions extends ListCommandOptions {
  all?: boolean | undefined;
  full?: boolean | undefined;
}

export interface PromoteCommandOptions extends ProjectCommandOptions {
  from: string;
  service?: string | undefined;
  to?: string | undefined;
  verbose?: boolean | undefined;
}

export interface DeploymentListCommandOptions extends ProjectCommandOptions {
  env?: string | undefined;
  limit?: string | undefined;
  service?: string | undefined;
}

export interface DeploymentLogsCommandOptions extends ProjectCommandOptions {
  env?: string | undefined;
  follow?: boolean | undefined;
  run?: string | undefined;
  service?: string | undefined;
  verbose?: boolean | undefined;
}

export interface RollbackCommandOptions extends ProjectCommandOptions {
  env?: string | undefined;
  run?: string | undefined;
  service?: string | undefined;
  to?: string | undefined;
  verbose?: boolean | undefined;
}

export interface EnvironmentCommandOptions extends ProjectCommandOptions {
  detach?: boolean | undefined;
  env?: string | undefined;
  service?: string | undefined;
  verbose?: boolean | undefined;
}

export interface DeployCommandOptions extends EnvironmentCommandOptions {
  label?: string | undefined;
}

export type InspectCommandOptions = EnvironmentCommandOptions;

export interface LogsCommandOptions extends EnvironmentCommandOptions {
  follow?: boolean | undefined;
}

export type SourceListCommandOptions = OutputOnlyOptions;

export type SourceShowCommandOptions = OutputOnlyOptions;

export interface SourceDisconnectCommandOptions extends OutputOnlyOptions {
  yes?: boolean | undefined;
}

export interface SourceRemoteCommandOptions {
  remote?: string | undefined;
}

export interface SourceConnectGitCommandOptions extends SourceRemoteCommandOptions {
  all?: boolean | undefined;
  autoAdoptNewApps?: string | undefined;
  autoDeploy?: boolean | undefined;
  branch?: string | undefined;
  env?: string | undefined;
  manual?: boolean | undefined;
}

export type SourceSyncCommandOptions = SourceRemoteCommandOptions;
export interface SourceSettingsSetCommandOptions extends OutputOnlyOptions {
  autoAdoptNewApps: string;
}
