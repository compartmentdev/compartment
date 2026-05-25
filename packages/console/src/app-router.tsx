import type { JSX } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, type DataRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { appRoutes } from './app-routes';
import { browserQueryClient } from './lib/browser-query-client';

const router: DataRouter = createBrowserRouter(appRoutes);

export function AppRouter(): JSX.Element {
  return (
    <QueryClientProvider client={browserQueryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
