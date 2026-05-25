import type { CliIo } from '../app.types';
import type { OutputFormat } from './output.types';

export function renderOutput<TValue>(io: CliIo, format: OutputFormat, value: TValue, text: string): void {
  if (format === 'json') {
    io.stdout(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  io.stdout(`${text}\n`);
}
