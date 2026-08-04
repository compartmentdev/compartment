import { readYamlFile, type YamlFileObject, type YamlFileValue } from './yaml-file';

const defaultChartName: string = 'compartment';
const kubernetesNameMaxLength: number = 63;

interface CompartmentChartNameValues {
  fullnameOverride?: string | undefined;
  nameOverride?: string | undefined;
}

export async function readCompartmentChartFullname(releaseName: string, valuesPath: string): Promise<string> {
  const values: YamlFileValue = await readYamlFile(valuesPath, 'operator values file');
  return resolveCompartmentChartFullname(releaseName, readChartNameValues(values, valuesPath));
}

function resolveCompartmentChartFullname(releaseName: string, values: CompartmentChartNameValues = {}): string {
  if (values.fullnameOverride !== undefined && values.fullnameOverride !== '') {
    return normalizeKubernetesName(values.fullnameOverride);
  }
  const configuredChartName: string | undefined = values.nameOverride;
  const chartName: string = normalizeKubernetesName(
    configuredChartName === undefined || configuredChartName === '' ? defaultChartName : configuredChartName,
  );
  return normalizeKubernetesName(releaseName.includes(chartName) ? releaseName : `${releaseName}-${chartName}`);
}

function readChartNameValues(value: YamlFileValue, valuesPath: string): CompartmentChartNameValues {
  if (!isYamlObject(value)) {
    throw new Error(`Operator values file "${valuesPath}" must contain a YAML object.`);
  }
  return {
    fullnameOverride: readOptionalString(value, 'fullnameOverride', valuesPath),
    nameOverride: readOptionalString(value, 'nameOverride', valuesPath),
  };
}

function readOptionalString(value: YamlFileObject, key: string, valuesPath: string): string | undefined {
  const candidate: YamlFileValue | undefined = value[key];
  if (candidate === undefined) {
    return undefined;
  }
  if (typeof candidate !== 'string') {
    throw new Error(`Operator values file "${valuesPath}" field ${key} must be a string.`);
  }
  return candidate;
}

function isYamlObject(value: YamlFileValue): value is YamlFileObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKubernetesName(value: string): string {
  return value.slice(0, kubernetesNameMaxLength).replace(/-+$/u, '');
}
