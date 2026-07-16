import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  organizationSettingsResponseSchema,
  type AuditEventType,
  type OrganizationSettingsResponse,
} from '@compartment/contracts';
import { expect } from 'vitest';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { enableK3dAuditFileSink, readK3dAuditFileSink } from './self-hosted-user-setup-k3d.harness';
import { readAuditExportEventTypes } from './self-hosted-user-setup-cli-response.harness';

const selfHostedAuditFileSinkPollAttempts: number = 30;
const selfHostedAuditFileSinkPollDelayMs: number = 1_000;
const incompleteAuditFileSinkLineMessage: string = 'Unexpected end of JSON input';

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
  return await enableK3dAuditFileSink();
}

async function expectSelfHostedAuditFileSinkEvent(auditFileSinkPath: string, eventType: AuditEventType): Promise<void> {
  let lastContent: string = '';
  for (let attempt: number = 0; attempt < selfHostedAuditFileSinkPollAttempts; attempt += 1) {
    lastContent = await readK3dAuditFileSink();

    if (readAuditFileSinkEventTypes(lastContent).includes(eventType)) {
      return;
    }

    await sleep(selfHostedAuditFileSinkPollDelayMs);
  }

  throw new Error(`Timed out waiting for ${eventType} in ${auditFileSinkPath}. Last content: ${lastContent}`);
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
