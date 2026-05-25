import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  organizationSettingsResponseSchema,
  type AuditEventType,
  type OrganizationSettingsResponse,
} from '@compartment/contracts';
import { quoteShellArgument } from '@compartment/utils';
import { expect } from 'vitest';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { readAuditExportEventTypes } from './self-hosted-user-setup-cli-response.harness';
import {
  expectSuccessfulCommand,
  selfHostedComposeFilesScript,
  selfHostedDockerComposeCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

const selfHostedAuditFileSinkPollAttempts: number = 30;
const selfHostedAuditFileSinkPollDelayMs: number = 1_000;
const selfHostedAuditFileSinkPathPrefix: string = 'audit_file_sink_path=';
const incompleteAuditFileSinkLineMessage: string = 'Unexpected end of JSON input';
const recreateSelfHostedApiScript: string = `
set -eu
${selfHostedComposeFilesScript}
${selfHostedDockerComposeCommand} up -d --wait --force-recreate api
`;
const enableSelfHostedAuditFileSinkScript: string = `
set -eu
env_file=/etc/compartment/.env.self-hosted
audit_dir=$(awk -F= '$1 == "COMPARTMENT_AUDIT_FILE_SINK_DIR" { print $2 }' "$env_file")
if [ -z "$audit_dir" ]; then
  audit_dir=/var/lib/compartment/audit-logs
fi
mkdir -p "$audit_dir"
rm -f "$audit_dir/audit.ndjson"

tmp_file=$(mktemp)
awk '
  BEGIN { found = 0 }
  /^COMPARTMENT_AUDIT_FILE_SINK_ENABLED=/ {
    print "COMPARTMENT_AUDIT_FILE_SINK_ENABLED=true"
    found = 1
    next
  }
  { print }
  END {
    if (found == 0) {
      print "COMPARTMENT_AUDIT_FILE_SINK_ENABLED=true"
    }
  }
' "$env_file" > "$tmp_file"
cat "$tmp_file" > "$env_file"
rm -f "$tmp_file"

${recreateSelfHostedApiScript}
${selfHostedDockerComposeCommand} exec -T api sh -c 'test "$COMPARTMENT_AUDIT_FILE_SINK_ENABLED" = true && test -d "$COMPARTMENT_AUDIT_FILE_SINK_DIR"'
printf 'audit_file_sink_path=%s/audit.ndjson\\n' "$audit_dir"
`;

export async function expectAuditFileSinkCoverage(cli: SelfHostedUserSetupCli): Promise<void> {
  const auditFileSinkPath: string = await enableSelfHostedAuditFileSink();
  const settings: OrganizationSettingsResponse = await cli.runJson(
    'org settings set --audit-retention indefinite',
    organizationSettingsResponseSchema,
  );
  expect(settings.settings.auditRetention.configured).toEqual({
    days: null,
    mode: 'indefinite',
  });
  await expectSelfHostedAuditFileSinkEvent(auditFileSinkPath, 'organization.settings.updated');
}

export async function expectAuditFileExports(
  cli: SelfHostedUserSetupCli,
  appDirectory: string,
  expectedAuditEventTypes: readonly AuditEventType[],
): Promise<void> {
  const auditNdjsonExportPath: string = join(appDirectory, 'audit-export.ndjson');
  await cli.run(`audit export --format ndjson --output ${auditNdjsonExportPath}`);
  const auditNdjsonExport: string = await readFile(auditNdjsonExportPath, 'utf8');
  expect(readAuditExportEventTypes(auditNdjsonExport)).toEqual(expect.arrayContaining([...expectedAuditEventTypes]));

  const auditCsvExportPath: string = join(appDirectory, 'audit-export.csv');
  await cli.run(`audit export --format csv --event organization.settings.updated --output ${auditCsvExportPath}`);
  const auditCsvExport: string = await readFile(auditCsvExportPath, 'utf8');
  expect(auditCsvExport).toContain('eventType');
  expect(auditCsvExport).toContain('organization.settings.updated');
}

async function enableSelfHostedAuditFileSink(): Promise<string> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['sudo', '-n', 'sh', '-c', enableSelfHostedAuditFileSinkScript],
    timeoutMs: 120_000,
  });

  expectSuccessfulCommand(result, 'enable self-hosted audit file sink');
  return readEnabledSelfHostedAuditFileSinkPath(result.stdout);
}

async function expectSelfHostedAuditFileSinkEvent(auditFileSinkPath: string, eventType: AuditEventType): Promise<void> {
  let lastContent: string = '';
  for (let attempt: number = 0; attempt < selfHostedAuditFileSinkPollAttempts; attempt += 1) {
    const result: SelfHostedUserSetupCommandResult = await runCommand({
      argv: ['sudo', '-n', 'sh', '-c', createReadSelfHostedAuditFileSinkScript(auditFileSinkPath)],
      timeoutMs: 15_000,
    });
    expectSuccessfulCommand(result, `read ${auditFileSinkPath}`);
    lastContent = result.stdout;

    if (readAuditFileSinkEventTypes(lastContent).includes(eventType)) {
      return;
    }

    await sleep(selfHostedAuditFileSinkPollDelayMs);
  }

  throw new Error(`Timed out waiting for ${eventType} in ${auditFileSinkPath}. Last content: ${lastContent}`);
}

function createReadSelfHostedAuditFileSinkScript(auditFileSinkPath: string): string {
  return `
set -eu
${selfHostedComposeFilesScript}
${selfHostedDockerComposeCommand} exec -T api sh -c 'cat "$1" 2>/dev/null || true' sh ${quoteShellArgument(auditFileSinkPath)}
`;
}

function readEnabledSelfHostedAuditFileSinkPath(stdout: string): string {
  const line: string | undefined = stdout
    .trim()
    .split('\n')
    .find((candidate: string): boolean => candidate.startsWith(selfHostedAuditFileSinkPathPrefix));
  const value: string | undefined = line?.slice(selfHostedAuditFileSinkPathPrefix.length);
  if (value === undefined || value === '') {
    throw new Error(`Expected audit file sink setup to print ${selfHostedAuditFileSinkPathPrefix}<path>.`);
  }

  return value;
}

function readAuditFileSinkEventTypes(content: string): string[] {
  try {
    return readAuditExportEventTypes(content);
  } catch (error) {
    const normalizedError: Error = error instanceof Error ? error : new Error(String(error));
    const lines: string[] = content.trimEnd().split('\n');
    const completeContent: string = lines.slice(0, -1).join('\n');
    if (!isIncompleteAuditFileSinkLineError(normalizedError)) {
      throw normalizedError;
    }

    return completeContent === '' ? [] : readAuditExportEventTypes(completeContent);
  }
}

function isIncompleteAuditFileSinkLineError(error: Error): boolean {
  return error instanceof SyntaxError && error.message.includes(incompleteAuditFileSinkLineMessage);
}
