export function requirePersistedRow<TRow>(row: TRow | undefined, label: string): TRow {
  if (row === undefined) {
    throw new Error(`Failed to persist ${label}.`);
  }

  return row;
}
