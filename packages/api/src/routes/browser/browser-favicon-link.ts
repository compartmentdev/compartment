import { getBrowserAssetPathname } from '../../browser-public-paths';

const browserFaviconAssetName: string = 'compartment-icon.svg';

export function renderBrowserFaviconLink(): string {
  return `<link rel="icon" type="image/svg+xml" sizes="any" href="${getBrowserAssetPathname(browserFaviconAssetName)}" />`;
}
