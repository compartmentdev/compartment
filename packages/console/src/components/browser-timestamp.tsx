import type { JSX } from 'react';
import { ServerTableCell } from './server-table';
import { formatBrowserTimestampParts, type BrowserTimestampParts } from '../lib/browser-timestamp-format';

interface BrowserTimestampProps {
  value: string;
}

interface BrowserTimestampTableCellProps {
  emptyLabel: string;
  value: string | null;
}

function BrowserTimestamp({ value }: Readonly<BrowserTimestampProps>): JSX.Element {
  const timestamp: BrowserTimestampParts = formatBrowserTimestampParts(value);

  return (
    <>
      <span className="block whitespace-nowrap">{timestamp.date}</span>
      <span className="block whitespace-nowrap">{timestamp.time}</span>
    </>
  );
}

export function BrowserTimestampTableCell({
  emptyLabel,
  value,
}: Readonly<BrowserTimestampTableCellProps>): JSX.Element {
  return (
    <ServerTableCell className="min-w-[10.5rem] whitespace-nowrap text-[12px] leading-5">
      {value === null ? emptyLabel : <BrowserTimestamp value={value} />}
    </ServerTableCell>
  );
}
