// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightDocsConfig from './starlight.config.mjs';

/** @type {import('@astrojs/starlight/types').StarlightConfig['head']} */
const faviconHead = [
  { tag: 'link', attrs: { rel: 'manifest', href: '/site.webmanifest' } },
  {
    tag: 'link',
    attrs: {
      rel: 'icon',
      href: '/favicon-dark.svg',
      type: 'image/svg+xml',
      media: '(prefers-color-scheme: dark)',
    },
  },
  {
    tag: 'link',
    attrs: {
      rel: 'icon',
      href: '/favicon-light-32x32.png',
      sizes: '32x32',
      type: 'image/png',
      media: '(prefers-color-scheme: light)',
    },
  },
  {
    tag: 'link',
    attrs: {
      rel: 'icon',
      href: '/favicon-dark-32x32.png',
      sizes: '32x32',
      type: 'image/png',
      media: '(prefers-color-scheme: dark)',
    },
  },
  {
    tag: 'link',
    attrs: { rel: 'icon', href: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
  },
  {
    tag: 'link',
    attrs: {
      rel: 'icon',
      href: '/favicon-light-16x16.png',
      sizes: '16x16',
      type: 'image/png',
      media: '(prefers-color-scheme: light)',
    },
  },
  {
    tag: 'link',
    attrs: {
      rel: 'icon',
      href: '/favicon-dark-16x16.png',
      sizes: '16x16',
      type: 'image/png',
      media: '(prefers-color-scheme: dark)',
    },
  },
  {
    tag: 'link',
    attrs: { rel: 'icon', href: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
  },
  {
    tag: 'link',
    attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
  },
];
export default defineConfig({
  site: starlightDocsConfig.site,
  integrations: [
    starlight({
      title: 'Compartment Docs',
      components: {
        Header: './src/components/starlight/Header.astro',
        PageSidebar: './src/components/starlight/PageSidebar.astro',
        SiteTitle: './src/components/starlight/SiteTitle.astro',
        TwoColumnContent: './src/components/starlight/TwoColumnContent.astro',
      },
      customCss: ['/src/styles/site.css'],
      head: faviconHead,
      plugins: [
        starlightLlmsTxt({
          ...starlightDocsConfig.llmsTxt,
        }),
      ],
      social: [{ icon: 'discord', label: 'Discord', href: 'https://discord.gg/uNxsg9vT' }],
      sidebar: starlightDocsConfig.sidebar,
    }),
  ],
});
