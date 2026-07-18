import { runMain } from '../lib/run-main.mjs';
import {
  acquirePlatformImageCacheDockerLock,
  releasePlatformImageCacheDockerLock,
} from './platform-k3d-e2e-support.mjs';

function readAction(args) {
  const [action, ...extraArgs] = args;
  if (!['acquire', 'release'].includes(action) || extraArgs.length > 0) {
    throw new Error('Usage: node ./scripts/deploy/manage-platform-image-cache-lock.mjs <acquire|release>');
  }
  return action;
}

runMain(import.meta.url, process.argv[1], async () => {
  const action = readAction(process.argv.slice(2));
  if (action === 'acquire') {
    await acquirePlatformImageCacheDockerLock();
  } else {
    releasePlatformImageCacheDockerLock();
  }
});
