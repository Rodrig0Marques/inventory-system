// Pure inventory rules, independent of the database. Covered by node:test.
export type InstallMode = 'FROM_STOCK' | 'REGISTER_INSTALLED';
export function stockTotals(available: number, installed: number) {
  if (![available, installed].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Saldo inválido.');
  if (!Number.isSafeInteger(available + installed)) throw new Error('Total fora do limite.');
  return { available, installed, total: available + installed };
}
export function quantityForBatch(quantity: number, assetCount: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000 || !Number.isInteger(assetCount) || assetCount < 1 || assetCount > 200) throw new Error('Quantidade inválida.');
  return quantity * assetCount;
}
export function afterInstall(available: number, installed: number, quantity: number, mode: InstallMode) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Quantidade inválida.');
  if (!['FROM_STOCK', 'REGISTER_INSTALLED'].includes(mode)) throw new Error('Origem inválida.');
  if (mode === 'FROM_STOCK' && quantity > available) throw new Error('Estoque insuficiente.');
  return stockTotals(available - (mode === 'FROM_STOCK' ? quantity : 0), installed + quantity);
}
export function afterRemoval(available: number, installed: number, quantity: number, disposition: 'RETURN_TO_STOCK' | 'RETIRE_INSTALLED') {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > installed) throw new Error('Quantidade inválida.');
  if (!['RETURN_TO_STOCK', 'RETIRE_INSTALLED'].includes(disposition)) throw new Error('Destino inválido.');
  return stockTotals(available + (disposition === 'RETURN_TO_STOCK' ? quantity : 0), installed - quantity);
}
