import { mkdir, writeFile } from 'node:fs/promises';

await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist/build.txt', import.meta.url), 'built with pnpm workspace\n', 'utf8');
