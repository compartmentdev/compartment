import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { main } from '../src/main.js';

describe('Store', () => {
  it('keeps the controller entrypoint reachable', () => expect(main).toBeTypeOf('function'));
  it('atomically persists a unique row and appends audit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't9-'));
    const audit = join(directory, 'audit.jsonl');
    const store = new Store(join(directory, 'db.json'), audit);
    const row = {
      id: 'one',
      desiredSpec: { image: 'nginx', replicas: 1, env: {} },
      status: 'desired' as const,
      observedAt: null,
    };
    await store.put(row);
    await store.put({ ...row, status: 'pending' });
    await store.audit({ id: 'one', kind: 'deleted', detail: 'test' });
    expect((await store.read()).rows).toEqual([{ ...row, status: 'pending' }]);
    expect(await readFile(audit, 'utf8')).toContain('"kind":"deleted"');
  });
});
