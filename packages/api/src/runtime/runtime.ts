import type { ApiConfig } from '../config';
import type { Database } from '../db/client';
import type { ApiRuntime } from './runtime.types';

let runtime: ApiRuntime | null = null;

export function configureApiRuntime(value: ApiRuntime): void {
  runtime = value;
}

export function clearApiRuntime(): void {
  runtime = null;
}

export function getApiConfig(): ApiConfig {
  return getApiRuntime().config;
}

export function getApiDatabase(): Database {
  return getApiRuntime().db;
}

function getApiRuntime(): ApiRuntime {
  const configuredRuntime: ApiRuntime | null = runtime;
  if (configuredRuntime === null) {
    throw new Error('API runtime is not configured.');
  }

  return configuredRuntime;
}
