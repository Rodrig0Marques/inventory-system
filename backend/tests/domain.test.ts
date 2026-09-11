import test from 'node:test';
import { jwtSecret } from '../src/utils/secret.js';
import assert from 'node:assert/strict';
import { stockTotals, afterInstall, afterRemoval, quantityForBatch } from '../src/modules/stock/domain.js';
import { visiblePoolFilter } from '../src/utils/visibility.js';

test('TXT: registering an installed 8gb 2666Ghz unit preserves the available quantity', () => {
  const before = stockTotals(2, 98);
  assert.deepEqual(before, { available: 2, installed: 98, total: 100 });
  const after = afterInstall(before.available, before.installed, 1, 'REGISTER_INSTALLED');
  assert.deepEqual(after, { available: 2, installed: 99, total: 101 });
  const other8gb = stockTotals(8, 92);
  assert.deepEqual(stockTotals(after.available + other8gb.available, after.installed + other8gb.installed), { total: 201, available: 10, installed: 191 });
});
test('installing from stock moves a unit but never increases the total', () => {
  assert.deepEqual(afterInstall(2, 98, 1, 'FROM_STOCK'), { total: 100, available: 1, installed: 99 });
});
test('external installed units can be registered even when no units are available', () => {
  assert.deepEqual(afterInstall(0, 0, 2, 'REGISTER_INSTALLED'), { total: 2, available: 0, installed: 2 });
});
test('stock cannot become negative', () => assert.throws(() => afterInstall(2, 98, 3, 'FROM_STOCK')));
test('returning a component preserves total', () => assert.deepEqual(afterRemoval(2, 98, 1, 'RETURN_TO_STOCK'), { total: 100, available: 3, installed: 97 }));
test('retiring a component reduces total but does not add available units', () => assert.deepEqual(afterRemoval(2, 98, 1, 'RETIRE_INSTALLED'), { total: 99, available: 2, installed: 97 }));
test('removing more than installed is rejected', () => assert.throws(() => afterRemoval(2, 1, 2, 'RETURN_TO_STOCK')));
test('quantity is multiplied by the number of equipment items', () => assert.equal(quantityForBatch(2, 25), 50));
for (const invalid of [0, -1, 1.5, NaN, Infinity, 10001]) test(`invalid component quantity ${invalid} is rejected`, () => assert.throws(() => quantityForBatch(invalid, 1)));
for (const invalid of [0, -1, 1.5, 201]) test(`invalid batch size ${invalid} is rejected`, () => assert.throws(() => quantityForBatch(1, invalid)));
test('totals reject negative and unsafe numbers', () => {
  assert.throws(() => stockTotals(-1, 1)); assert.throws(() => stockTotals(1, -1)); assert.throws(() => stockTotals(0, NaN)); assert.throws(() => stockTotals(Number.MAX_SAFE_INTEGER, 1));
});
test('arithmetic invariants across 1000 combinations', () => {
  for (let i = 0; i < 1000; i++) {
    const available = i % 20, installed = (i * 7) % 100, q = 1 + i % 8;
    const external = afterInstall(available, installed, q, 'REGISTER_INSTALLED');
    assert.equal(external.total, available + installed + q); assert.equal(external.available, available);
    if (q <= available) { const moved = afterInstall(available, installed, q, 'FROM_STOCK'); assert.equal(moved.total, available + installed); assert.equal(moved.available, available - q); }
  }
});
for (const role of ['VIEWER', 'MANAGER']) {
  test(`${role} only sees assigned pools`, () => assert.deepEqual(visiblePoolFilter(role, ['RH']), { poolId: { in: ['RH'] } }));
  test(`${role} may query its own pool`, () => assert.deepEqual(visiblePoolFilter(role, ['RH'], 'RH'), { poolId: 'RH' }));
  test(`${role} cannot request TI when assigned to RH`, () => assert.throws(() => visiblePoolFilter(role, ['RH'], 'TI'), (e: any) => e.statusCode === 404));
  test(`${role} without membership sees nothing`, () => assert.deepEqual(visiblePoolFilter(role, []), { poolId: { in: [] } }));
}
test('missing membership never grants global access', () => {
  assert.deepEqual(visiblePoolFilter('VIEWER', null), { poolId: { in: [] } });
  assert.deepEqual(visiblePoolFilter(undefined, undefined), { poolId: { in: [] } });
});
test('ADMIN has explicit global access', () => assert.deepEqual(visiblePoolFilter('ADMIN', null), {}));
test('ADMIN can select a particular pool', () => assert.deepEqual(visiblePoolFilter('ADMIN', null, 'TI'), { poolId: 'TI' }));

test('known placeholder and missing JWT secrets are rejected', () => {
  for (const value of [undefined, '', '123123123', 'change-me-in-production', 'change-me-in-production-12345678901234567890']) assert.throws(() => jwtSecret(value));
});
test('a sufficiently long non-placeholder JWT key is accepted', () => assert.equal(jwtSecret('b37a489c934604150a16656d54f8ee062c8a506142a2aa02524d2d9b2e8a9f1d').length, 64));
