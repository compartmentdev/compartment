// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { docsHomePath } from './site-config.mjs';

const docsSiteHref = 'https://docs.compartment.dev';
const docsHomeSidebarItem = docsHomePath.replace(/^\//, '').replace(/\/$/, '');
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
  site: docsSiteHref,
  integrations: [
    starlight({
      title: 'Compartment Docs',
      components: {
        PageSidebar: './src/components/starlight/PageSidebar.astro',
        SiteTitle: './src/components/starlight/SiteTitle.astro',
        TwoColumnContent: './src/components/starlight/TwoColumnContent.astro',
      },
      customCss: ['/src/styles/site.css'],
      head: faviconHead,
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/compartmentdev/compartment' }],
      sidebar: [
        {
          label: 'Quickstart',
          items: [docsHomeSidebarItem, 'quickstart/install-compartment', 'quickstart/first-deploy'],
        },
        {
          label: 'Install & Operate',
          items: [
            'install-operate/install-modes',
            'install-operate/install-domain',
            'install-operate/system-operations',
          ],
        },
        {
          label: 'Deploy Apps',
          items: [
            'deploy-apps/deploy-using-cli',
            'deploy-apps/deploy-using-git',
            'deploy-apps/deployment-lifecycle',
            'deploy-apps/projects-and-app-urls',
            'deploy-apps/runtime-variables',
            'deploy-apps/resources',
            'deploy-apps/custom-domains-for-apps',
            'deploy-apps/project-descriptor',
            'deploy-apps/route-rules',
          ],
        },
        {
          label: 'Manage Access',
          items: [
            'manage-access/login-activation-and-the-control-plane',
            'manage-access/access-organizations-users-and-roles',
            'manage-access/grant-access-to-users-and-groups',
            'manage-access/roles-and-permissions',
            'manage-access/audit-logs',
            'manage-access/troubleshoot-access',
            'manage-access/single-sign-on',
          ],
        },
        {
          label: 'Reference',
          items: [
            'reference/cli-reference',
            { label: 'Generated CLI Reference', autogenerate: { directory: 'reference/generated/cli' } },
            'reference/schema-reference',
            { label: 'Generated Schema Reference', autogenerate: { directory: 'reference/generated/schema' } },
            'reference/glossary',
          ],
        },
      ],
    }),
  ],
});
