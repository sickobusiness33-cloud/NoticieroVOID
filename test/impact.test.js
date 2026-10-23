import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impactFor, typicalMove, UNIVERSE, TRANSMISSION, tagAssets } from '../public/js/shared/impact.js';
import { classify } from '../public/js/shared/news.js';

test('every scenario references only assets in the universe and only ±1 directions', () => {
  const ids = new Set(UNIVERSE.map((a) => a.id));
  for (const [cat, list] of Object.entries(TRANSMISSION)) {
    assert.equal(list.length, 2, `${cat} must have two opposite branches`);
    for (const s of list) for (const [id, d] of Object.entries(s.moves)) {
      assert.ok(ids.has(id), `${cat}/${s.key}: unknown asset ${id}`);
      assert.ok(d === 1 || d === -1);
    }
    // The two branches must never point the same asset in the same direction.
    const [a, b] = list;
    for (const id of Object.keys(a.moves)) if (id in b.moves) assert.notEqual(a.moves[id], b.moves[id], `${cat}: ${id} not opposite`);
  }
});

test('impact for a Fed article lists mentioned assets first and both policy branches', () => {
  const item = { title: 'Fed signals rate cut as Bitcoin and gold rally', excerpt: '' };
  Object.assign(item, classify(item));
  const r = impactFor(item);
  assert.deepEqual(r.mentioned, ['BTC', 'GOLD']);
  assert.equal(r.assets[0], 'BTC');
  assert.ok(r.scenarios.some((s) => s.key === 'hawkish') && r.scenarios.some((s) => s.key === 'dovish'));
});

test('uncategorized article falls back to generic risk scenarios', () => {
  const r = impactFor({ title: 'Company announces new office', categories: ['general'] });
  assert.deepEqual(r.categories, ['markets']);
});

test('commodities are classified and tagged (EN/ES)', () => {
  assert.ok(classify({ title: 'OPEC+ extends oil output cuts', excerpt: '' }).categories.includes('commodities'));
  assert.deepEqual(tagAssets('El petróleo Brent y el oro suben'), ['WTI', 'BRENT', 'GOLD']);
});

test('typical move in percent and basis points', () => {
  const pts = Array.from({ length: 61 }, (_, i) => ({ date: String(i), value: 100 * (i % 2 ? 1.01 : 1) }));
  const m = typicalMove(pts, 'pct');
  assert.equal(m.n, 60); assert.ok(m.sigma > 0.9 && m.sigma < 1.1);
  const y = typicalMove(Array.from({ length: 30 }, (_, i) => ({ date: String(i), value: i % 2 ? 4.1 : 4.0 })), 'bp');
  assert.equal(y.unit, 'bp'); assert.ok(Math.abs(y.sigma - 10.17) < 0.2);
  assert.equal(typicalMove([{ date: 'a', value: 1 }]), null);
});
