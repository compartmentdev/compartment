import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Store } from '../src/store.js';
import { main } from '../src/main.js';

describe('Store', () => {
  it('keeps the controller entrypoint reachable', () => assert.equal(typeof main, 'function'));
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
    assert.deepEqual((await store.read()).rows, [{ ...row, status: 'pending' }]);
    assert.match(await readFile(audit, 'utf8'), /"kind":"deleted"/);
  });
});
