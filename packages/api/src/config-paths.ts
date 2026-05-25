import { isAbsolute, resolve } from 'node:path';

export function resolveConfiguredPath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}
