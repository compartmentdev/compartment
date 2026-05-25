export type ListPathParamValue = number | readonly string[] | string | undefined;

export interface ListPathParam {
  name: string;
  value: ListPathParamValue;
}

export function buildListPath(pathname: string, params: readonly ListPathParam[]): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  for (const param of params) {
    appendOptionalListParam(searchParams, param);
  }

  const search: string = searchParams.toString();
  return search === '' ? pathname : `${pathname}?${search}`;
}

function appendOptionalListParam(searchParams: URLSearchParams, param: ListPathParam): void {
  if (param.value === undefined) {
    return;
  }

  if (typeof param.value === 'string' || typeof param.value === 'number') {
    searchParams.set(param.name, String(param.value));
    return;
  }

  for (const value of param.value) {
    searchParams.append(param.name, value);
  }
}
