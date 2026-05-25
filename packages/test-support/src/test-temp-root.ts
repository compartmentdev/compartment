import { tmpdir } from 'node:os';
import { join } from 'node:path';

const unixSocketPathByteLimit: number = 103;
const mkdtempSuffixLength: number = 6;
const shortSystemTempRootDirectory: string = '/tmp';

export function readSocketSafeTempRootDirectory(directoryPrefix: string, socketFileName: string): string {
  const systemTempRootDirectory: string = tmpdir();
  if (fitsUnixSocketPathBudget(systemTempRootDirectory, directoryPrefix, socketFileName)) {
    return systemTempRootDirectory;
  }

  return shortSystemTempRootDirectory;
}

function fitsUnixSocketPathBudget(rootDirectory: string, directoryPrefix: string, socketFileName: string): boolean {
  return (
    Buffer.byteLength(
      join(rootDirectory, `${directoryPrefix}${'x'.repeat(mkdtempSuffixLength)}`, 's', socketFileName),
    ) <= unixSocketPathByteLimit
  );
}
