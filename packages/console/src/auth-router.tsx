import type { JSX } from 'react';
import { createBrowserRouter, type DataRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { browserActivatePathname, browserLoginPathname, browserResetPasswordPathname } from './browser-public-paths';
import { ActivatePage, loadActivatePage } from './features/auth/activate-page';
import { loadLoginPage, LoginPage } from './features/auth/login-page';
import { loadResetPasswordPage, ResetPasswordPage } from './features/auth/reset-password-page';

const router: DataRouter = createBrowserRouter([
  {
    Component: LoginPage,
    loader: loadLoginPage,
    path: browserLoginPathname,
  },
  {
    Component: ActivatePage,
    loader: loadActivatePage,
    path: browserActivatePathname,
  },
  {
    Component: ResetPasswordPage,
    loader: loadResetPasswordPage,
    path: browserResetPasswordPathname,
  },
]);

export function AuthRouter(): JSX.Element {
  return <RouterProvider router={router} />;
}
