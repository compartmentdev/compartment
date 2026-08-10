import { pathToFileURL } from 'node:url';

export function runMain(importMetaUrl, argv1, main) {
  if (argv1 === undefined || importMetaUrl !== pathToFileURL(argv1).href) {
    return;
  }

  // Resolving through a promise accepts a synchronous main as well as an async one, so a gate that
  // reports failure by throwing lands on the same stderr and exit-code path.
  void Promise.resolve()
    .then(main)
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
