import type { Card } from './cards';

export const CAT = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight',
  'Flush', 'Full house', 'Four of a kind', 'Straight flush',
];
const CATBASE = 16 ** 5;

function straightHigh(m: number): number {
  const b = (m << 1) | ((m >> 12) & 1);
  for (let t = 13; t >= 4; t--) if (((b >> (t - 4)) & 31) === 31) return t - 1;
  return -1;
}

export function enc(cat: number, a: number[]): number {
  let v = cat;
  for (let i = 0; i < 5; i++) v = v * 16 + (i < a.length ? a[i] : 0);
  return v;
}

/** Score 5–7 cards. Higher is better; ties compare equal. */
export function evalHand(cards: readonly Card[]): number {
  const rc = new Int8Array(13);
  const sc = [0, 0, 0, 0];
  const sm = [0, 0, 0, 0];
  let mask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i], r = c >> 2, s = c & 3;
    rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
  }
  let flushMask = 0;
  for (let s = 0; s < 4; s++) {
    if (sc[s] >= 5) {
      const sh = straightHigh(sm[s]);
      if (sh >= 0) return enc(8, [sh]);
      flushMask = sm[s];
    }
  }
  const quads: number[] = [], trips: number[] = [], pairs: number[] = [];
  for (let r = 12; r >= 0; r--) {
    const n = rc[r];
    if (n === 4) quads.push(r);
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
  }
  const topOthers = (ex: number[], k: number) => {
    const o: number[] = [];
    for (let r = 12; r >= 0 && o.length < k; r--) if (rc[r] && !ex.includes(r)) o.push(r);
    return o;
  };
  if (quads.length) return enc(7, [quads[0], ...topOthers([quads[0]], 1)]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const p = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return enc(6, [trips[0], p]);
  }
  if (flushMask) {
    const o: number[] = [];
    for (let r = 12; r >= 0 && o.length < 5; r--) if (flushMask & (1 << r)) o.push(r);
    return enc(5, o);
  }
  const sh = straightHigh(mask);
  if (sh >= 0) return enc(4, [sh]);
  if (trips.length) return enc(3, [trips[0], ...topOthers([trips[0]], 2)]);
  if (pairs.length >= 2) return enc(2, [pairs[0], pairs[1], ...topOthers([pairs[0], pairs[1]], 1)]);
  if (pairs.length === 1) return enc(1, [pairs[0], ...topOthers([pairs[0]], 3)]);
  return enc(0, topOthers([], 5));
}

export const catOf = (v: number) => Math.floor(v / CATBASE);
export const catName = (v: number) => CAT[catOf(v)];
