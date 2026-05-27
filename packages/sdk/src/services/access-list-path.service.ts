import { buildListPath } from './list-path.service';

export function buildAccessListOptionsPath(pathname: string): string {
  return buildListPath(pathname, [{ name: 'detail', value: 'options' }]);
}
