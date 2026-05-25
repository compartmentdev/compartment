import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TabsLiftedDemo from '../src/components/shadcn-studio/tabs/tabs-13';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('ui tabs', (): void => {
  it('renders the shadcn studio lifted tabs component', (): void => {
    vi.stubGlobal('React', React);

    const html: string = renderToStaticMarkup(React.createElement(TabsLiftedDemo));

    expect(html).toContain('role="tablist"');
    expect(html).toContain('Active');
    expect(html).toContain('Archived');
    expect(html).toContain('All');
    expect(html).toContain('data-state="active"');
    expect(html).toContain('trigger-all');
  });
});
