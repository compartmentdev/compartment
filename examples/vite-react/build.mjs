import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executeFileAsync = promisify(execFile);
const buildGreeting = process.env.VITE_PUBLIC_GREETING;

if (!buildGreeting) {
  throw new Error('VITE_PUBLIC_GREETING is required for the vite-react example build.');
}

await executeFileAsync('npx', ['vite', 'build'], {
  env: {
    ...process.env,
    COMPARTMENT_BUILD_OUT_DIR: 'dist',
    VITE_PUBLIC_GREETING: buildGreeting,
  },
});
