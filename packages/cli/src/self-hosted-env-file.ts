import { hasText } from '@compartment/utils';
import {
  readSelfHostedEnvironmentAssignmentName,
  readSelfHostedEnvironmentAssignmentValue,
} from './self-hosted-env-assignment';

export function readSelfHostedEnvironmentValues(environmentText: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of environmentText.split('\n')) {
    const variableName: string | null = readSelfHostedEnvironmentAssignmentName(line);
    if (variableName === null) {
      continue;
    }

    values[variableName] = readSelfHostedEnvironmentAssignmentValue(line);
  }

  return values;
}

export function readRequiredSelfHostedEnvironmentPort(values: Record<string, string>, variableName: string): number {
  const rawValue: string = readRequiredSelfHostedEnvironmentValue(values, variableName);
  if (/^\d+$/u.test(rawValue)) {
    const port: number = Number(rawValue);
    if (port >= 1 && port <= 65535) {
      return port;
    }
  }

  throw new Error(`The self-hosted environment has an invalid ${variableName} value: ${rawValue}.`);
}

export function readRequiredSelfHostedEnvironmentValue(values: Record<string, string>, variableName: string): string {
  const value: string | undefined = values[variableName];
  if (hasText(value)) {
    return value;
  }

  throw new Error(`The self-hosted environment is missing ${variableName}.`);
}

export function readRequiredSelfHostedEnvironmentRawValue(
  values: Record<string, string>,
  variableName: string,
): string {
  const value: string | undefined = values[variableName];
  if (value !== undefined) {
    return value;
  }

  throw new Error(`The self-hosted environment is missing ${variableName}.`);
}
