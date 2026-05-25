import type { ComponentProps, JSX } from 'react';
import { NativeSelect } from './ui/native-select';

type SelectProps = ComponentProps<typeof NativeSelect>;

export function Select(props: Readonly<SelectProps>): JSX.Element {
  return <NativeSelect {...props} />;
}
