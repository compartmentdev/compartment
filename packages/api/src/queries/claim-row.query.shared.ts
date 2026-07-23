export async function claimSelectedRow<Transaction, Row, Result>(
  transaction: Transaction,
  lockClaimableRow: (transaction: Transaction) => Promise<Row | undefined>,
  stampClaim: (transaction: Transaction, row: Row) => Promise<Result>,
  empty: Result,
): Promise<Result> {
  const row: Row | undefined = await lockClaimableRow(transaction);
  return row === undefined ? empty : await stampClaim(transaction, row);
}
