import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadManagedVmKernelModules } from '../src/services/managed-vm-kernel-modules.service';

let directory: string;
let originalPath: string | undefined;

beforeEach(async (): Promise<void> => {
  directory = await mkdtemp(join(tmpdir(), 'compartment-modprobe-'));
  originalPath = process.env.PATH;
  process.env.PATH = directory;
  process.env.COMPARTMENT_MODULE_LOG = join(directory, 'modules.log');
  await writeFakeModprobe();
});

afterEach(async (): Promise<void> => {
  process.env.PATH = originalPath;
  delete process.env.COMPARTMENT_FAIL_MODULE;
  delete process.env.COMPARTMENT_MODULE_LOG;
  await rm(directory, { force: true, recursive: true });
});

describe('managed VM kernel modules', (): void => {
  it('loads every required module through the host command boundary', async (): Promise<void> => {
    await expect(loadManagedVmKernelModules()).resolves.toBeUndefined();

    await expect(readModuleLog()).resolves.toBe('overlay\nbr_netfilter\nnf_tables\n');
  });

  it('fails closed when a required module cannot load', async (): Promise<void> => {
    process.env.COMPARTMENT_FAIL_MODULE = 'br_netfilter';

    await expect(loadManagedVmKernelModules()).rejects.toThrow('modprobe failed (12)');
    await expect(readModuleLog()).resolves.toBe('overlay\nbr_netfilter\n');
  });
});

async function writeFakeModprobe(): Promise<void> {
  const path: string = join(directory, 'modprobe');
  const script: string = `#!/bin/sh
printf '%s\\n' "$1" >> "$COMPARTMENT_MODULE_LOG"
if [ "$1" = "$COMPARTMENT_FAIL_MODULE" ]; then
  exit 12
fi
`;
  await writeFile(path, script);
  await chmod(path, 0o755);
}

async function readModuleLog(): Promise<string> {
  return await readFile(process.env.COMPARTMENT_MODULE_LOG ?? '', 'utf8');
}
