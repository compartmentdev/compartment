import { writeFile } from 'node:fs/promises';
import {
  auditEventExportFormatSchema,
  auditEventTypeSchema,
  type AuditEventExportFormat,
  type AuditEventListQuery,
  type AuditEventListResponse,
  type AuditEventSummary,
  type AuditEventType,
} from '@compartment/contracts';
import type { Command } from 'commander';
import type { SafeParseReturnType } from 'zod';
import { renderOutput } from '../../output/render';
import { exportOrganizationAuditEvents, listOrganizationAuditEvents } from '../../services/audit-events.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, ListCommandOptions } from '../command.types';
import {
  addListPaginationOptions,
  createPaginationHint,
  readListCommandPagination,
  type ResolvedListCommandPagination,
} from '../list-pagination.command';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

interface AuditListCommandOptions extends ListCommandOptions {
  actor?: string | undefined;
  event?: string | undefined;
  from?: string | undefined;
  project?: string | undefined;
  targetType?: string | undefined;
  to?: string | undefined;
}

interface AuditExportCommandOptions {
  actor?: string | undefined;
  event?: string | undefined;
  format: string;
  from?: string | undefined;
  output: string;
  project?: string | undefined;
  remote?: string | undefined;
  targetType?: string | undefined;
  to?: string | undefined;
}

export function registerAuditCommands(program: Command, dependencies: CliCommandDependencies): void {
  const auditCommand: Command = program.command('audit').description('Organization audit log commands');
  registerAuditListCommand(auditCommand, dependencies);
  registerAuditExportCommand(auditCommand, dependencies);
}

function registerAuditListCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    addListPaginationOptions(
      program
        .command('list')
        .option('--from <time>', 'include events at or after this ISO time')
        .option('--to <time>', 'include events at or before this ISO time')
        .option('--event <type>', 'event type')
        .option('--actor <actor>', 'actor principal id or email')
        .option('--target-type <type>', 'target type')
        .option('--project <projectId>', 'project id')
        .option('--output <format>', 'text or json', 'text'),
    ),
  ).action(
    async (options: AuditListCommandOptions): Promise<void> => await executeAuditListCommand(dependencies, options),
  );
}

function registerAuditExportCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('export')
      .option('--from <time>', 'include events at or after this ISO time')
      .option('--to <time>', 'include events at or before this ISO time')
      .option('--event <type>', 'event type')
      .option('--actor <actor>', 'actor principal id or email')
      .option('--target-type <type>', 'target type')
      .option('--project <projectId>', 'project id')
      .option('--format <format>', 'ndjson or csv', 'ndjson')
      .option('--output <path>', 'output file path, or - for stdout', '-'),
  ).action(
    async (options: AuditExportCommandOptions): Promise<void> => await executeAuditExportCommand(dependencies, options),
  );
}

async function executeAuditListCommand(
  dependencies: CliCommandDependencies,
  options: AuditListCommandOptions,
): Promise<void> {
  const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
  const response: AuditEventListResponse = await listOrganizationAuditEvents(context, buildAuditListQuery(options));
  renderOutput(dependencies.io, options.output, response, createAuditListMessage(response));
}

async function executeAuditExportCommand(
  dependencies: CliCommandDependencies,
  options: AuditExportCommandOptions,
): Promise<void> {
  const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
  const content: Buffer = await exportOrganizationAuditEvents(context, {
    ...buildAuditFilterQuery(options),
    format: parseAuditExportFormat(options.format),
  });

  if (options.output === '-') {
    dependencies.io.stdout(content.toString('utf8'));
    return;
  }

  await writeFile(options.output, content);
}

function buildAuditListQuery(options: AuditListCommandOptions): AuditEventListQuery {
  const pagination: ResolvedListCommandPagination = readListCommandPagination(options);
  return {
    ...buildAuditFilterQuery(options),
    page: pagination.page,
    perPage: pagination.perPage,
  };
}

function buildAuditFilterQuery(
  options: Pick<AuditListCommandOptions, 'actor' | 'event' | 'from' | 'project' | 'targetType' | 'to'>,
): Omit<AuditEventListQuery, 'page' | 'perPage'> {
  return {
    actor: options.actor,
    eventType: parseAuditEventType(options.event),
    from: normalizeAuditTimeFilter(options.from, '--from'),
    project: options.project,
    targetType: options.targetType,
    to: normalizeAuditTimeFilter(options.to, '--to'),
  };
}

function createAuditListMessage(response: AuditEventListResponse): string {
  if (response.events.length === 0) {
    return 'No audit events found.';
  }

  const rows: string[] = response.events.map(formatAuditEventRow);
  const hint: string | null = createPaginationHint({
    itemName: 'audit events',
    pagination: response.pagination,
  });

  return hint === null ? rows.join('\n') : `${rows.join('\n')}\n${hint}`;
}

function formatAuditEventRow(event: AuditEventSummary): string {
  const actor: string = event.actor.email ?? event.actor.principalId ?? event.actor.type;
  const targetName: string = event.target.displayName ?? event.target.id;
  return `${event.occurredAt}\t${event.eventType}\t${event.status}\t${actor}\t${event.target.type}:${targetName}`;
}

function parseAuditEventType(value: string | undefined): AuditEventType | undefined {
  if (value === undefined) {
    return undefined;
  }

  return auditEventTypeSchema.parse(value);
}

function parseAuditExportFormat(value: string): AuditEventExportFormat {
  const parsedFormat: SafeParseReturnType<string, AuditEventExportFormat> =
    auditEventExportFormatSchema.safeParse(value);
  if (!parsedFormat.success) {
    throw new Error(`Invalid format "${value}". Use one of: csv, ndjson.`);
  }

  return parsedFormat.data;
}

function normalizeAuditTimeFilter(value: string | undefined, optionName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed: Date = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${optionName} must be a valid date or ISO timestamp.`);
  }

  return parsed.toISOString();
}
