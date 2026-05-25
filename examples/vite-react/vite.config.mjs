import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const buildOutDir = process.env.COMPARTMENT_BUILD_OUT_DIR;

if (!buildOutDir) {
  throw new Error('COMPARTMENT_BUILD_OUT_DIR is required for the vite-react example build.');
}

export default defineConfig({
  build: {
    outDir: buildOutDir,
  },
  plugins: [react()],
});
