import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workerJobEntrypoints } from '../src/worker-entrypoints';

const packageDirectory: string = resolve(__dirname, '..');
const entrypoints: string[] = Object.values<string>(workerJobEntrypoints);
const distributionExists: boolean = existsSync(resolve(packageDirectory, 'dist'));

describe('worker image entrypoints', (): void => {
  /**
   * `tsc -p tsconfig.build.json` mirrors `src` into `dist`, so a registered `dist/<name>.js` ships only if
   * `src/<name>.ts` exists. Checking the source keeps this assertion honest in a working tree that was
   * never built, where a missing `dist` would otherwise read as a passing test.
   */
  it.each(entrypoints)('builds %s from a source module', (entrypoint: string): void => {
    expect(existsSync(resolve(packageDirectory, sourcePathOf(entrypoint)))).toBe(true);
  });

  it.runIf(distributionExists).each(entrypoints)('ships %s in the built image layout', (entrypoint: string): void => {
    expect(existsSync(resolve(packageDirectory, entrypoint))).toBe(true);
  });
});

function sourcePathOf(entrypoint: string): string {
  return entrypoint.replace(/^dist\//u, 'src/').replace(/\.js$/u, '.ts');
}
