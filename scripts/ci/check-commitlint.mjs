import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDirectory = mkdtempSync(join(tmpdir(), 'commitlint-'));
const messageFile = join(tempDirectory, 'message.txt');

writeFileSync(messageFile, 'chore(repo): validate commitlint wiring\n');

try {
  execFileSync('pnpm', ['exec', 'commitlint', '--edit', messageFile], { stdio: 'inherit' });
} finally {
  rmSync(tempDirectory, { force: true, recursive: true });
}
