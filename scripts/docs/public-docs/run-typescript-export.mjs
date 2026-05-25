const [moduleHref, exportName] = process.argv.slice(2);

if (moduleHref === undefined || exportName === undefined) {
  throw new Error('Expected module href and export name.');
}

const module = await import(moduleHref);
const exportValue = module[exportName] ?? module.default?.[exportName];

if (typeof exportValue !== 'function') {
  throw new Error(`Expected ${exportName} from ${moduleHref} to be a function export.`);
}

const response = await exportValue();
process.stdout.write(JSON.stringify(response));
