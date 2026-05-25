import eslintPluginAstro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';
import { publicDocsAstroFiles } from './shared.mjs';

export default [
  ...eslintPluginAstro.configs['flat/recommended'],
  {
    files: publicDocsAstroFiles,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'astro/no-set-html-directive': 'off',
    },
  },
];
