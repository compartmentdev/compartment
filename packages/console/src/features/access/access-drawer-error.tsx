import type { JSX } from 'react';
import { DismissibleAlert } from '../../components/dismissible-alert';

interface AccessDrawerErrorAlertProps {
  message: string | undefined;
}

export function AccessDrawerErrorAlert({ message }: Readonly<AccessDrawerErrorAlertProps>): JSX.Element | null {
  if (message === undefined) {
    return null;
  }

  return <DismissibleAlert className="mt-4" message={message} variant="error" />;
}
