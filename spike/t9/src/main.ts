import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller, failpoint } from './controller.js';
import { KubernetesRuntime, loadKubeConfig, objectName } from './kubernetes.js';
import { Store } from './store.js';
import type { Row } from './types.js';

export async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '..');
  const store = new Store(
    process.env.T9_DB ?? resolve(root, 'state/db.json'),
    process.env.T9_AUDIT ?? resolve(root, 'state/audit.jsonl'),
  );
  const command = process.argv[2] ?? 'run';

  if (command === 'seed') {
    const id = process.argv[3] ?? 'sample';
    objectName(id);
    const row: Row = {
      id,
      desiredSpec: { image: 'nginx:1.27-alpine', replicas: 1, env: { T9: id } },
      status: 'desired',
      observedAt: null,
    };
    await store.put(row);
    await failpoint('after-desired-before-apply', resolve(root, 'state/killpoint'));
  } else {
    const controller = new Controller(store, new KubernetesRuntime(loadKubeConfig()), resolve(root, 'state/killpoint'));
    const shutdown = (): void => {
      void controller.stop().then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await controller.start();
    console.log('CONTROLLER_READY');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
