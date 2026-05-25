import { CronExpressionParser } from 'cron-parser';

export function readRequiredCronExpression(value: string, variableName: string): string {
  const normalizedValue: string = value.trim();
  try {
    CronExpressionParser.parse(normalizedValue, { strict: false });
  } catch {
    throw new Error(`${variableName} must be a valid cron expression.`);
  }

  return normalizedValue;
}

export function parseOptionalPositiveInt(value: string | undefined, variableName: string): number | null {
  const normalizedValue: string = value?.trim() ?? '';
  if (normalizedValue === '') {
    return null;
  }

  const parsedValue: number = Number(normalizedValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${variableName} must be empty or a positive integer.`);
  }

  return parsedValue;
}

export function parseOptionalAbsoluteUrl(value: string | undefined, variableName: string): string | null {
  const normalizedValue: string = value?.trim() ?? '';
  if (normalizedValue === '') {
    return null;
  }

  try {
    const url: URL = new URL(normalizedValue);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol.');
    }
    return url.toString();
  } catch {
    throw new Error(`${variableName} must be empty or an absolute HTTP(S) URL.`);
  }
}
