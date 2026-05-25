const chunk = (values, size) => {
  if (values.length === 0) {
    return [];
  }

  return [values.slice(0, size), ...chunk(values.slice(size), size)];
};

const buildEslintCommands = (stagedFiles) =>
  chunk(stagedFiles, 25).map((files) => `eslint --max-warnings=0 ${files.map((file) => `"${file}"`).join(' ')}`);

export default {
  '*': ['prettier --write --ignore-unknown'],
  '*.{js,cjs,mjs,ts,mts}': buildEslintCommands,
  '.husky/**/*.{js,cjs,mjs,ts,mts}': buildEslintCommands,
  '.codex/skills/**/scripts/**/*.{js,cjs,mjs,ts,tsx,mts,cts}': buildEslintCommands,
  'scripts/**/*.{js,cjs,mjs,ts,tsx,mts,cts}': buildEslintCommands,
  'packages/*/**/*.{js,cjs,mjs,ts,tsx,mts,cts}': buildEslintCommands,
  'public-docs/**/*.{js,cjs,mjs,ts,tsx,mts,cts,astro}': buildEslintCommands,
  'examples/**/*.{js,cjs,mjs,ts,tsx,mts,cts}': buildEslintCommands,
};
