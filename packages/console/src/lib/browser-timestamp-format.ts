const browserTimestampFormatter: Intl.DateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const browserTimestampDateFormatter: Intl.DateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});
const browserTimestampTimeFormatter: Intl.DateTimeFormat = new Intl.DateTimeFormat(undefined, {
  timeStyle: 'short',
});

export interface BrowserTimestampParts {
  date: string;
  time: string;
}

export function formatBrowserTimestamp(value: string): string {
  return browserTimestampFormatter.format(new Date(value));
}

export function formatBrowserTimestampParts(value: string): BrowserTimestampParts {
  const date: Date = new Date(value);

  return {
    date: browserTimestampDateFormatter.format(date),
    time: browserTimestampTimeFormatter.format(date),
  };
}
