import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executeFileAsync = promisify(execFile);

await executeFileAsync('npx', ['vite', 'build'], {
  env: {
    ...process.env,
    COMPARTMENT_BUILD_OUT_DIR: 'dist',
  },
});
