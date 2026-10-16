import { type Card, RANKS } from './cards';
import { enc, evalHand } from './evaluator';

export const combosOf = (c: string) => (c.length === 2 ? 6 : c[2] === 's' ? 4 : 12);
export const rangePct = (set: Iterable<string>) => [...set].reduce((a, c) => a + combosOf(c), 0) / 1326;

/** Every starting-hand class (169). */
export const ALL_CLASSES: string[] = (() => {
  const out: string[] = [];
  for (let a = 12; a >= 0; a--)
    for (let b = a; b >= 0; b--) {
      if (a === b) out.push(RANKS[a] + RANKS[a]);
      else { out.push(RANKS[a] + RANKS[b] + 's'); out.push(RANKS[a] + RANKS[b] + 'o'); }
    }
  return out;
})();

/** Chen formula: a standard quick preflop strength score. */
export function chen(cls: string): number {
  const v = (r: number) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  const a = RANKS.indexOf(cls[0]), b = RANKS.indexOf(cls[1]);
  if (a === b) return Math.max(5, v(a) * 2);
  let sc = v(a);
  if (cls[2] === 's') sc += 2;
  const gap = a - b - 1;
  sc -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && a < 10) sc += 1;
  return Math.ceil(sc);
}

export const RANKED: string[] = ALL_CLASSES.slice().sort(
  (x, y) =>
    chen(y) - chen(x) ||
    RANKS.indexOf(y[0]) - RANKS.indexOf(x[0]) ||
    RANKS.indexOf(y[1]) - RANKS.indexOf(x[1]) ||
    Number(y[2] === 's') - Number(x[2] === 's'),
);

/** The strongest `p` fraction (0..1) of all starting hands, by combos. */
export function topRange(p: number): Set<string> {
  const set = new Set<string>();
  let c = 0;
  for (const h of RANKED) {
    if (c >= p * 1326) break;
    set.add(h);
    c += combosOf(h);
  }
  return set;
}

export type Combo = [Card, Card];

export function classCombos(cls: string): Combo[] {
  const a = RANKS.indexOf(cls[0]), b = RANKS.indexOf(cls[1]);
  const out: Combo[] = [];
  for (let s1 = 0; s1 < 4; s1++)
    for (let s2 = 0; s2 < 4; s2++) {
      if (a === b) { if (s2 <= s1) continue; }
      else if (cls[2] === 's') { if (s1 !== s2) continue; }
      else if (s1 === s2) continue;
      out.push([a * 4 + s1, b * 4 + s2]);
    }
  return out;
}

/** All concrete combos in a range (or every hand when `set` is null), minus dead cards. */
export function combosFor(set: Iterable<string> | null | undefined, dead: readonly Card[] = []): Combo[] {
  const d = new Set(dead);
  const out: Combo[] = [];
  for (const cls of set ? [...set] : ALL_CLASSES)
    for (const c of classCombos(cls)) if (!d.has(c[0]) && !d.has(c[1])) out.push(c);
  return out;
}

/** Current strength of a combo on a board; draws count as roughly a middle pair. */
export function comboStrength(c: readonly Card[], board: readonly Card[]): number {
  const v = evalHand(c.concat(board));
  if (board.length >= 5) return v;
  const all = c.concat(board);
  const sc = [0, 0, 0, 0];
  all.forEach((x) => sc[x & 3]++);
  let draw = 0;
  for (let s = 0; s < 4; s++)
    if (sc[s] === 4 && ((c[0] & 3) === s || (c[1] & 3) === s)) draw = Math.max(draw, enc(1, [12]));
  let m = 0;
  all.forEach((x) => (m |= 1 << (x >> 2)));
  const mm = (m << 1) | ((m >> 12) & 1);
  for (let t = 13; t >= 4; t--) {
    let k = 0;
    for (let j = 0; j < 5; j++) if (mm & (1 << (t - j))) k++;
    if (k >= 4) { draw = Math.max(draw, enc(1, [8])); break; }
  }
  return Math.max(v, draw);
}

/** Keep the strongest `keep` fraction of combos on this board (models "they bet"). */
export function narrow(combos: Combo[], board: readonly Card[], keep: number): Combo[] {
  if (keep >= 0.999 || board.length < 3) return combos;
  const sc = combos.map((c) => [comboStrength(c, board), c] as const).sort((a, b) => b[0] - a[0]);
  return sc.slice(0, Math.max(8, Math.ceil(sc.length * keep))).map((x) => x[1]);
}
