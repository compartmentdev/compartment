import { resolve } from 'node:path';

export function resolveCompartmentConsoleAssetDirectory(): string {
  return resolve(__dirname, '../browser-dist');
}
