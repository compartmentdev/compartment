import {
  browserLoginCliCompletedPathname,
  browserLoginCliPathname,
  browserLoginPathname,
} from '../../browser-public-paths';
import { browserNoReferrerPolicy } from './browser-anti-framing.headers';
import { renderBrowserFaviconLink } from './browser-favicon-link';

type CliLoginCompletedStatus = 'failed' | 'success';

export function renderCliLoginCompletedPage(status: CliLoginCompletedStatus = 'success'): string {
  return status === 'failed' ? renderFailedCliLoginCompletedPage() : renderSuccessfulCliLoginCompletedPage();
}

function renderFailedCliLoginCompletedPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CLI login failed</title>
    ${renderBrowserFaviconLink()}
  </head>
  <body>
    <main>
      <h1>CLI login failed</h1>
      <p>The browser sign-in finished, but this CLI login attempt is no longer valid. Return to the terminal and run the login again.</p>
    </main>
  </body>
</html>`;
}

function renderSuccessfulCliLoginCompletedPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CLI login successful</title>
    ${renderBrowserFaviconLink()}
  </head>
  <body>
    <main>
      <h1>Login successful</h1>
      <p>You can close this page.</p>
    </main>
  </body>
</html>`;
}

export function renderCliLoginStartPage(errorUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="${browserNoReferrerPolicy}" />
    <title>CLI login</title>
    ${renderBrowserFaviconLink()}
  </head>
  <body>
    <main>
      <p>Starting CLI login…</p>
      <noscript>JavaScript is required to continue this CLI login.</noscript>
    </main>
    <script>${renderCliLoginStartPageScript(errorUrl)}</script>
  </body>
</html>`;
}

function renderCliLoginStartPageScript(errorUrl: string): string {
  return `
    const params = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const code = fragment.get('code');
    const attempt = params.get('attempt');
    if (attempt === null || code === null) {
      window.location.replace(${JSON.stringify(errorUrl)});
    } else {
${renderCliLoginStartRedirectScript(errorUrl)}
    }
  `;
}

function renderCliLoginStartRedirectScript(errorUrl: string): string {
  return `
      window.history.replaceState(null, '', ${JSON.stringify(browserLoginCliPathname)});
      void fetch(${JSON.stringify(browserLoginCliPathname)}, {
        body: JSON.stringify({ attempt, code }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok || typeof payload.loginUrl !== 'string') {
            throw new Error('invalid-cli-login-start-response');
          }
          window.location.replace(payload.loginUrl);
        })
        .catch(() => {
          window.location.replace(${JSON.stringify(errorUrl)});
        });
  `;
}

export function buildCliLoginCompletedUrl(status: CliLoginCompletedStatus = 'success'): string {
  if (status === 'success') {
    return browserLoginCliCompletedPathname;
  }

  return `${browserLoginCliCompletedPathname}?status=failed`;
}

export function buildCliLoginStartResponseBody(organizationSlug?: string): { loginUrl: string } {
  const loginUrl: URL = new URL(browserLoginPathname, 'http://compartment.localhost');
  if (organizationSlug !== undefined) {
    loginUrl.searchParams.set('organizationSlug', organizationSlug);
  }

  return {
    loginUrl: `${loginUrl.pathname}${loginUrl.search}`,
  };
}
