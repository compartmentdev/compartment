export function readNonCompartmentEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const filteredEnv: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !name.startsWith('COMPARTMENT_')) {
      filteredEnv[name] = value;
    }
  }

  return filteredEnv;
}
