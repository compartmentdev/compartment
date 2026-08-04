import { docsHomePath } from './site-config.mjs';

const docsHomeSidebarItem = docsHomePath.replace(/^\//, '').replace(/\/$/, '');

const docsSidebar = [
  {
    label: 'Quickstart',
    items: [docsHomeSidebarItem, 'quickstart/install-compartment', 'quickstart/first-deploy'],
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
    label: 'Install and Operate',
    items: [
      'install-operate/install-modes',
      'install-operate/install-domain',
      'install-operate/system-operations',
      'guides/operate-managed-vm',
    ],
  },
  {
    label: 'Reference',
    collapsed: true,
    items: [
      'reference/cli-reference',
      {
        label: 'Generated CLI Reference',
        collapsed: true,
        autogenerate: { directory: 'reference/generated/cli', collapsed: true },
      },
      'reference/schema-reference',
      {
        label: 'Generated Schema Reference',
        collapsed: true,
        autogenerate: { directory: 'reference/generated/schema', collapsed: true },
      },
      'reference/glossary',
    ],
  },
];

const docsLlmsCustomSets = [
  {
    label: 'Quickstart',
    paths: ['quickstart/**'],
    description: 'introductory pages for understanding Compartment, installing the CLI, and deploying the first app',
  },
  {
    label: 'Deploy Apps',
    paths: ['deploy-apps/**'],
    description: 'deployment workflows, project descriptors, app URLs, runtime variables, resources, and route rules',
  },
  {
    label: 'Manage Access',
    paths: ['manage-access/**'],
    description: 'login, activation, organizations, users, roles, groups, assignments, audit logs, and SSO',
  },
  {
    label: 'Install and Operate',
    paths: ['install-operate/**', 'guides/operate-managed-vm'],
    description: 'Kubernetes install targets, domains, platform operations, and managed VM lifecycle',
  },
  {
    label: 'Reference',
    paths: ['reference/**'],
    description: 'CLI help, generated command reference, generated schema reference, and glossary entries',
  },
];

function collectSidebarPageSlugs() {
  const slugs = [];
  for (const sidebarGroup of docsSidebar) {
    for (const item of sidebarGroup.items) {
      if (typeof item === 'string') {
        slugs.push(item);
      }
    }
  }

  return slugs;
}

const starlightDocsConfig = {
  site: 'https://docs.compartment.dev',
  sidebar: docsSidebar,
  llmsTxt: {
    projectName: 'Compartment Docs',
    description:
      'Compartment is a self-hosted application deployment system for teams that want to ship and share internal, private, or public web apps without building their own platform stack.',
    details:
      'Use these files for shipped Compartment user and operator workflows. Generated CLI and schema reference content reflects the current repository source.',
    customSets: docsLlmsCustomSets,
    promote: collectSidebarPageSlugs(),
    pageSeparator: '\n\n---\n\n',
  },
};

export default starlightDocsConfig;
