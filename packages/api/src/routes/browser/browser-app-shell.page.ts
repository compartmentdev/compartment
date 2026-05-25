import type { BrowserAppShellPageInput } from './browser-app-shell.page.types';
import { getBrowserAssetPathname } from '../../browser-public-paths';
import { escapeHtml } from './browser-page.shared';
import { renderBrowserFaviconLink } from './browser-favicon-link';

export function renderBrowserAppShellPage(input: BrowserAppShellPageInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    ${renderBrowserFaviconLink()}
    <link rel="stylesheet" href="${getBrowserAssetPathname('styles.css')}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${getBrowserAssetPathname(`${input.bundle}.js`)}"></script>
  </body>
</html>`;
}
