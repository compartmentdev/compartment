import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const distAssetsDirectory = resolve(packageRoot, 'dist/assets');

const assetCopies = [
  {
    from: resolve(repositoryRoot, 'docker-compose.self-hosted.yml'),
    to: resolve(distAssetsDirectory, 'docker-compose.self-hosted.yml'),
  },
  {
    from: resolve(repositoryRoot, 'docker-compose.self-hosted.local.yml'),
    to: resolve(distAssetsDirectory, 'docker-compose.self-hosted.local.yml'),
  },
  {
    from: resolve(repositoryRoot, '.env.self-hosted.example'),
    to: resolve(distAssetsDirectory, '.env.self-hosted.example'),
  },
];

await rm(distAssetsDirectory, { force: true, recursive: true });

for (const assetCopy of assetCopies) {
  await mkdir(dirname(assetCopy.to), { recursive: true });
  await copyFile(assetCopy.from, assetCopy.to);
}
