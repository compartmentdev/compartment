import type { JsonValue } from '@compartment/utils';
import type { CommandResult } from '../command-runner.types';
import type { KubernetesImageTrustJsonObject } from './kubernetes-image-trust.service.types';

export function readImageTrustJson(value: string, message: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    throw new Error(message);
  }
}

export function readImageTrustObject(value: JsonValue | undefined, label: string): KubernetesImageTrustJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value;
}

export function createImageTrustCommandError(prefix: string, result: CommandResult): Error {
  const output: string = [result.stderr.trim(), result.stdout.trim()]
    .filter((value: string): boolean => value !== '')
    .join('\n');
  return new Error(output === '' ? prefix : `${prefix}\n${output}`);
}
