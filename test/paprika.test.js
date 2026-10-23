import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPaprika } from '../src/adapters/crypto.js';

test('CoinPaprika rows map to CoinGecko ids, keep rank order and null out zero windows', () => {
  const q = (price, d7) => ({ USD: { price, market_cap: 1, volume_24h: 1, percent_change_1h: 0.1, percent_change_24h: -1, percent_change_7d: d7, percent_change_30d: 0 } });
  const rows = mapPaprika([
    { id: 'eth-ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2, quotes: q(2400, 3) },
    { id: 'btc-bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1, quotes: q(81000, 0) },
    { id: 'paxg-pax-gold', symbol: 'PAXG', name: 'PAX Gold', rank: 0, quotes: q(4000, 1) },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['bitcoin', 'ethereum', 'pax-gold']);
  assert.equal(rows[0].change7d, null);
  assert.equal(rows[0].change30d, null);
  assert.equal(rows[1].change7d, 3);
  assert.ok(rows.every((r) => r.provider === 'CoinPaprika' && r.sparkline === null));
});
