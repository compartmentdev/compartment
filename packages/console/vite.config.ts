import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { compartmentBrowserAssetsPathname } from '@compartment/contracts/browser';
import { defineConfig, type UserConfig } from 'vite';

function resolveConsoleManualChunk(id: string): string | undefined {
  const normalizedId = id.split(path.sep).join('/');

  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/')
  ) {
    return 'vendor-react';
  }

  if (normalizedId.includes('/node_modules/react-router/')) {
    return 'vendor-router';
  }

  if (normalizedId.includes('/node_modules/@radix-ui/') || normalizedId.includes('/node_modules/lucide-react/')) {
    return 'vendor-ui';
  }

  if (
    normalizedId.includes('/node_modules/zod/') ||
    normalizedId.includes('/node_modules/cron-parser/') ||
    normalizedId.includes('/packages/contracts/dist/')
  ) {
    return 'vendor-contracts';
  }

  return undefined;
}

export default defineConfig({
  base: `${compartmentBrowserAssetsPathname}/`,
  build: {
    cssCodeSplit: true,
    commonjsOptions: {
      include: [/packages\/contracts\/dist/, /node_modules/],
    },
    emptyOutDir: true,
    outDir: path.resolve(__dirname, 'browser-dist'),
    rollupOptions: {
      input: {
        auth: path.resolve(__dirname, 'src/auth-main.tsx'),
        browser: path.resolve(__dirname, 'src/main.tsx'),
      },
      output: {
        assetFileNames: '[name][extname]',
        chunkFileNames: 'browser-[name].js',
        entryFileNames: '[name].js',
        manualChunks: resolveConsoleManualChunk,
      },
    },
  },
  plugins: [react(), tailwindcss()],
  publicDir: path.resolve(__dirname, 'public'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@compartment/utils': path.resolve(__dirname, '../utils/src/browser.ts'),
    },
  },
  root: path.resolve(__dirname, 'src'),
} satisfies UserConfig);
