import { runMain } from '../lib/run-main.mjs';
import {
  acquirePlatformImageCacheDockerLock,
  releasePlatformImageCacheDockerLock,
} from './platform-image-cache-lock.mjs';

function readCommand(args) {
  const [action, ownerToken, ...extraArgs] = args;
  if (
    !['acquire', 'release'].includes(action) ||
    ownerToken === undefined ||
    ownerToken === '' ||
    extraArgs.length > 0
  ) {
    throw new Error(
      'Usage: node ./scripts/deploy/manage-platform-image-cache-lock.mjs <acquire|release> <owner-token>',
    );
  }
  return { action, ownerToken };
}

runMain(import.meta.url, process.argv[1], async () => {
  const { action, ownerToken } = readCommand(process.argv.slice(2));
  if (action === 'acquire') {
    await acquirePlatformImageCacheDockerLock(ownerToken);
  } else {
    releasePlatformImageCacheDockerLock(ownerToken);
  }
});
