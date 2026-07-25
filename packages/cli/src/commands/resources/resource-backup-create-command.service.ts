import type { ResourceBackupCreateResponse } from '@compartment/contracts';
import type { CliIo } from '../../app.types';
import { renderOutput } from '../../output/render';
import type { OutputFormat } from '../../output/output.types';
import { ReportedCliError } from '../../reported-error';
import { createResourceBackupCreateMessage } from './resource.command.output';

export function renderResourceBackupCreateResult(
  io: CliIo,
  output: OutputFormat,
  response: ResourceBackupCreateResponse,
): void {
  const message: string = createResourceBackupCreateMessage(response);
  renderOutput(io, output, response, message);
  if (response.backup.status === 'failed') {
    throw new ReportedCliError(message);
  }
}
