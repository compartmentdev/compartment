const packageScopes = [
  'api',
  'cli',
  'console',
  'contracts',
  'docker',
  'edge',
  'eslint-config',
  'eslint-plugin',
  'kube-runtime',
  'node',
  'sdk',
  'source-archive',
  'test-support',
  'utils',
  'worker',
  'public-docs',
];

const rootScopes = ['scripts', 'root-config', 'docs', 'examples', 'release'];

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'release', 'refactor', 'style', 'test', 'build', 'ci', 'docs', 'chore'],
    ],
    'scope-enum': [2, 'always', [...packageScopes, ...rootScopes]],
    'scope-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'type-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
  },
};
