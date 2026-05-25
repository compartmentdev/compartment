import { renderOutput } from '../../output/render';
import type { OutputFormat } from '../../output/output.types';
import type { AuthenticatedContext } from '../../services/context.types';
import { assertValidProjectName } from '../projects/project.command.helpers';
import type { CliCommandDependencies } from '../command.types';
import { createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { followLogsWithPolling } from './logs-follow.service';

interface FollowableLogsCommandOptions {
  follow?: boolean | undefined;
  output: OutputFormat;
  project?: string | undefined;
  remote?: string | undefined;
}

interface ExecuteFollowableLogsCommandInput<Response, Line, Options extends FollowableLogsCommandOptions> {
  createFollowLineSignature: (line: Line) => string;
  dependencies: CliCommandDependencies;
  options: Options;
  readLines: (response: Response) => Line[];
  readResponse: (context: AuthenticatedContext, options: Options, since?: string) => Promise<Response>;
  readTimestamp: (line: Line) => string;
  renderInitial: (response: Response, options: Options) => string;
  renderLines: (response: Response, lines: Line[], options: Options) => string;
}

export async function executeFollowableLogsCommand<Response, Line, Options extends FollowableLogsCommandOptions>(
  input: ExecuteFollowableLogsCommandInput<Response, Line, Options>,
): Promise<void> {
  validateFollowableLogsCommandOptions(input.options);
  const context: AuthenticatedContext = await createRemoteAuthenticatedContext(input.options);
  if (input.options.follow === true) {
    await followFollowableLogsCommand(input, context);
    return;
  }

  const response: Response = await input.readResponse(context, input.options);
  renderOutput(input.dependencies.io, input.options.output, response, input.renderInitial(response, input.options));
}

function validateFollowableLogsCommandOptions(options: FollowableLogsCommandOptions): void {
  if (options.project !== undefined) {
    assertValidProjectName(options.project);
  }
  if (options.follow === true && options.output === 'json') {
    throw new Error('`--follow` cannot be combined with `--output json`.');
  }
}

async function followFollowableLogsCommand<Response, Line, Options extends FollowableLogsCommandOptions>(
  input: ExecuteFollowableLogsCommandInput<Response, Line, Options>,
  context: AuthenticatedContext,
): Promise<void> {
  await followLogsWithPolling({
    createSignature: input.createFollowLineSignature,
    io: input.dependencies.io,
    readInitial: async (): Promise<Response> => await input.readResponse(context, input.options),
    readLines: input.readLines,
    readSince: async (since: string | undefined): Promise<Response> =>
      await input.readResponse(context, input.options, since),
    readTimestamp: input.readTimestamp,
    renderInitial: (response: Response): string => input.renderInitial(response, input.options),
    renderLines: (response: Response, lines: Line[]): string => input.renderLines(response, lines, input.options),
  });
}
