import { pathToFileURL } from 'node:url';

export function runMain(importMetaUrl, argv1, main) {
  if (argv1 === undefined || importMetaUrl !== pathToFileURL(argv1).href) {
    return;
  }

  void main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
